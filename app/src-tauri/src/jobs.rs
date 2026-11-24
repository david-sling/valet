// A job is a command that keeps running in the background after start_job returns. Its output stays in memory on
// this computer, and the job ends with the session, whoever ends it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::sandbox;
use crate::types::now_ms;

pub const MAX_RUNNING: usize = 3;
pub const WAIT_DEFAULT: u64 = 20;
pub const WAIT_MAX: u64 = 20;
const KEEP: usize = 8 * 1024 * 1024;
const PAGE: usize = 64 * 1024;
const TAIL: usize = 4 * 1024;
const SHOWN: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Running,
    Exited,
    Stopped,
}

struct Inner {
    state: State,
    exit_code: Option<i32>,
    ended_at: Option<i64>,
    stopped_by: Option<String>,
    // the latest output; start is how many bytes came before kept[0]
    kept: Vec<u8>,
    start: u64,
}

pub struct Job {
    pub id: String,
    pub literal: String,
    pub started_at: i64,
    inner: Mutex<Inner>,
    tick: watch::Sender<u64>,
    stop: CancellationToken,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub literal: String,
    pub state: State,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub exit_code: Option<i32>,
    pub tail: String,
}

// the text and how many bytes it used: a page can end partway through a character, which then starts the next page
fn text(bytes: &[u8]) -> (String, usize) {
    let mut end = bytes.len();
    let mut back = 0;
    while back < 3 && end > 0 && (bytes[end - 1] & 0xC0) == 0x80 {
        end -= 1;
        back += 1;
    }
    let complete = match bytes.get(end.wrapping_sub(1)) {
        Some(&b) if b >= 0xC0 => {
            let width = if b >= 0xF0 { 4 } else if b >= 0xE0 { 3 } else { 2 };
            back + 1 >= width
        }
        _ => true,
    };
    let used = if complete { bytes.len() } else { end - 1 };
    (String::from_utf8_lossy(&bytes[..used]).into_owned(), used)
}

fn last(bytes: &[u8], n: usize) -> String {
    let mut from = bytes.len().saturating_sub(n);
    while from < bytes.len() && (bytes[from] & 0xC0) == 0x80 {
        from += 1;
    }
    String::from_utf8_lossy(&bytes[from..]).into_owned()
}

impl Job {
    pub fn launch(id: String, literal: String, spawned: sandbox::Job, stop: CancellationToken, ended: impl FnOnce(&Job) + Send + 'static) -> Arc<Job> {
        let (tick, _) = watch::channel(0);
        let job = Arc::new(Job {
            id,
            literal,
            started_at: now_ms(),
            inner: Mutex::new(Inner { state: State::Running, exit_code: None, ended_at: None, stopped_by: None, kept: vec![], start: 0 }),
            tick,
            stop,
        });
        let sandbox::Job { mut child, stdout, stderr, group } = spawned;
        let out = tokio::spawn(Self::collect(job.clone(), stdout));
        let err = tokio::spawn(Self::collect(job.clone(), stderr));
        let me = job.clone();
        tokio::spawn(async move {
            let status = tokio::select! {
                s = child.wait() => s.ok(),
                _ = me.stop.cancelled() => None,
            };
            match status {
                Some(_) => group.reap(),
                None => group.stop().await,
            }
            let _ = tokio::time::timeout(Duration::from_secs(5), async {
                let _ = out.await;
                let _ = err.await;
            })
            .await;
            {
                let mut i = me.lock();
                i.ended_at = Some(now_ms());
                match status {
                    Some(s) => {
                        i.state = State::Exited;
                        i.exit_code = Some(s.code().unwrap_or(-1));
                    }
                    None => {
                        i.state = State::Stopped;
                        i.stopped_by.get_or_insert_with(|| "session".into());
                    }
                }
            }
            me.tick.send_modify(|n| *n += 1);
            ended(&me);
        });
        job
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    async fn collect(job: Arc<Job>, mut r: impl AsyncRead + Unpin) {
        let mut chunk = [0u8; 16 * 1024];
        while let Ok(n) = r.read(&mut chunk).await {
            if n == 0 {
                break;
            }
            {
                let mut i = job.lock();
                i.kept.extend_from_slice(&chunk[..n]);
                // dropping a megabyte at a time keeps this from shifting the buffer on every read
                if i.kept.len() > KEEP + 1024 * 1024 {
                    let drop = i.kept.len() - KEEP;
                    i.kept.drain(..drop);
                    i.start += drop as u64;
                }
            }
            job.tick.send_modify(|n| *n += 1);
        }
    }

    pub fn running(&self) -> bool {
        self.lock().state == State::Running
    }

    pub fn stop(&self, by: &str) {
        {
            let mut i = self.lock();
            if i.state != State::Running {
                return;
            }
            i.stopped_by = Some(by.into());
        }
        self.stop.cancel();
    }

    pub async fn ended(&self) {
        let mut rx = self.tick.subscribe();
        while self.running() {
            if rx.changed().await.is_err() {
                return;
            }
        }
    }

    pub fn status(&self) -> Value {
        let i = self.lock();
        let now = now_ms();
        let mut v = json!({
            "job_id": self.id,
            "command": self.literal,
            "state": i.state,
            "started_at": self.started_at,
            "elapsed_s": (i.ended_at.unwrap_or(now) - self.started_at) / 1000,
            "bytes": i.start + i.kept.len() as u64,
        });
        if let Some(c) = i.exit_code {
            v["exit_code"] = json!(c);
        }
        if let Some(at) = i.ended_at {
            v["ended_at"] = json!(at);
        }
        if let Some(by) = &i.stopped_by {
            v["stopped_by"] = json!(by);
        }
        v
    }

    pub fn facts(&self) -> Value {
        let i = self.lock();
        json!({
            "job_id": self.id,
            "state": i.state,
            "exit_code": i.exit_code,
            "duration_ms": i.ended_at.unwrap_or_else(now_ms) - self.started_at,
            "bytes": i.start + i.kept.len() as u64,
            "stopped_by": i.stopped_by,
        })
    }

    pub fn view(&self) -> JobView {
        let i = self.lock();
        JobView {
            id: self.id.clone(),
            literal: self.literal.clone(),
            state: i.state,
            started_at: self.started_at,
            ended_at: i.ended_at,
            exit_code: i.exit_code,
            tail: last(&i.kept, 2 * 1024),
        }
    }

    pub fn bytes(&self) -> u64 {
        let i = self.lock();
        i.start + i.kept.len() as u64
    }

    // what the person sees when they open a job: the latest output, as much as fits a screen or two
    pub fn recent(&self) -> Value {
        let i = self.lock();
        json!({ "text": last(&i.kept, SHOWN), "cut": i.start > 0 || i.kept.len() > SHOWN, "state": i.state })
    }

    pub fn read(&self, from: Option<u64>) -> Value {
        let i = self.lock();
        let total = i.start + i.kept.len() as u64;
        let from = from.unwrap_or(0).min(total);
        let skipped = i.start.saturating_sub(from);
        let at = (from.max(i.start) - i.start) as usize;
        let end = (at + PAGE).min(i.kept.len());
        let (content, used) = text(&i.kept[at..end]);
        let next = from.max(i.start) + used as u64;
        let mut v = json!({
            "content": content,
            "next": next,
            "more": next < total,
            "state": i.state,
        });
        if skipped > 0 {
            v["skipped_bytes"] = json!(skipped);
        }
        v
    }

    // read_job_output with a wait: holds until there is output past from, the job ends, or the time is up
    pub async fn follow(&self, from: Option<u64>, seconds: u64, cancel: &CancellationToken) -> Value {
        let mut rx = self.tick.subscribe();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds.min(WAIT_MAX));
        let at = from.unwrap_or(0);
        while seconds > 0 && self.running() && self.bytes() <= at {
            tokio::select! {
                r = rx.changed() => if r.is_err() { break },
                _ = tokio::time::sleep_until(deadline) => break,
                _ = cancel.cancelled() => break,
            }
        }
        self.read(from)
    }

    fn seen(&self, until: Option<&str>) -> bool {
        let Some(t) = until.filter(|t| !t.is_empty()) else { return false };
        let i = self.lock();
        i.kept.windows(t.len()).any(|w| w == t.as_bytes())
    }

    // Returns when the job ends, when until shows up in its output, or after seconds, whichever comes first
    pub async fn wait(&self, until: Option<&str>, seconds: u64, cancel: &CancellationToken) -> Value {
        let mut rx = self.tick.subscribe();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds.clamp(1, WAIT_MAX));
        let matched = loop {
            if self.seen(until) {
                break true;
            }
            if !self.running() {
                break false;
            }
            tokio::select! {
                r = rx.changed() => if r.is_err() { break false },
                _ = tokio::time::sleep_until(deadline) => break false,
                _ = cancel.cancelled() => break false,
            }
        };
        let mut v = self.status();
        if until.is_some() {
            v["matched"] = json!(matched);
        }
        let i = self.lock();
        v["tail"] = json!(last(&i.kept, TAIL));
        v["next"] = json!(i.start + i.kept.len() as u64);
        v
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use crate::types::{Grant, Kind, Need, Risk, Source};
    use std::path::{Path, PathBuf};

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("valet-jobs-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(d).unwrap()
    }

    fn run(script: &str) -> Arc<Job> {
        let g = |p: &str| Grant {
            id: p.into(),
            on: true,
            source: Source::Proposed,
            need: Need { kind: Kind::Programs, access: "run".into(), scope: p.into(), risk: Risk::Low, protected_label: None },
            expires_at: None,
        };
        let grants = [g("/bin/sleep"), g("/bin/echo")];
        let argv = vec!["/bin/sh".to_string(), "-c".into(), script.into()];
        let spawned = sandbox::spawn_job(Path::new("/bin/sh"), &argv, None, &grants, &[], &tmp()).unwrap();
        Job::launch("j1".into(), script.into(), spawned, CancellationToken::new(), |_| {})
    }

    #[tokio::test]
    async fn waits_for_text_then_for_the_end() {
        let job = run("echo starting; sleep 1; echo ready; sleep 1; echo done");
        let v = job.wait(Some("ready"), 10, &CancellationToken::new()).await;
        assert_eq!(v["matched"], true);
        assert_eq!(v["state"], "running");
        let v = job.wait(None, 10, &CancellationToken::new()).await;
        assert_eq!(v["state"], "exited");
        assert_eq!(v["exit_code"], 0);
        let page = job.read(None);
        assert_eq!(page["content"], "starting\nready\ndone\n");
        assert_eq!(page["more"], false);
        assert_eq!(job.read(page["next"].as_u64())["content"], "");
        let started = std::time::Instant::now();
        assert_eq!(job.follow(page["next"].as_u64(), 5, &CancellationToken::new()).await["content"], "");
        assert!(started.elapsed() < Duration::from_secs(1), "an ended job has nothing to wait for");
        assert_eq!((job.recent()["text"].as_str(), job.recent()["cut"].as_bool()), (Some("starting\nready\ndone\n"), Some(false)));
    }

    #[tokio::test]
    async fn following_returns_as_soon_as_new_output_arrives() {
        let job = run("echo one; sleep 1; echo two; sleep 30");
        job.wait(Some("one"), 5, &CancellationToken::new()).await;
        let first = job.read(None);
        let started = std::time::Instant::now();
        let next = job.follow(first["next"].as_u64(), 10, &CancellationToken::new()).await;
        assert_eq!(next["content"], "two\n");
        assert!(started.elapsed() < Duration::from_secs(3));
        job.stop("agent");
        job.ended().await;
    }

    #[tokio::test]
    async fn stopping_ends_it_and_says_who() {
        let job = run("sleep 30");
        let started = std::time::Instant::now();
        job.stop("agent");
        job.ended().await;
        assert!(started.elapsed() < Duration::from_secs(5));
        let v = job.status();
        assert_eq!(v["state"], "stopped");
        assert_eq!(v["stopped_by"], "agent");
    }

    #[test]
    fn a_page_never_splits_a_character() {
        assert_eq!(text("é".as_bytes()[..1].as_ref()), (String::new(), 0));
        assert_eq!(text("aé".as_bytes()), ("aé".to_string(), 3));
        assert_eq!(text("a€".as_bytes()[..3].as_ref()), ("a".to_string(), 1));
        assert_eq!(last("aé".as_bytes(), 1), "");
        assert_eq!(last("aé".as_bytes(), 2), "é");
    }
}
