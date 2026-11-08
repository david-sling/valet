use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

use crate::approve;
use crate::needs::{normalise_scope, plan, rate, tilde, Plan, Request};
use crate::policy::{decide, grants_from, scopes_for, Scope};
use crate::relay::{InboxAction, Relay, RelayError};
use crate::sandbox::{self, Ran};
use crate::store::Store;
use crate::tools::{self, Failure};
use crate::types::{now_ms, Grant, Need, Risk, Source};

const ARMING: Duration = Duration::from_millis(600);
const FEED_OUTPUT: usize = 64 * 1024;
const MAX_GRANTS: usize = 200;
const PAGE: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Joined,
    Live,
    Ended,
    Declined,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FeedItem {
    #[serde(rename = "event")]
    Event { id: u64, at: i64, text: String },
    #[serde(rename = "action")]
    Action {
        id: u64,
        at: i64,
        tool: String,
        literal: String,
        outcome: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        method: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        diff: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        note: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptView {
    pub id: String,
    pub tool: String,
    pub literal: String,
    pub program: Option<String>,
    pub cwd: Option<String>,
    pub needs: Vec<Need>,
    pub risk: Risk,
    pub reason: String,
    pub scopes: Vec<Scope>,
    pub asked_at: i64,
    pub diff: Option<Vec<String>>,
    pub output: Option<String>,
    pub output_next: Option<usize>,
    pub busy: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub text: String,
    pub next: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub id: String,
    pub phase: Phase,
    pub sender_name: String,
    pub purpose: String,
    pub verified: bool,
    pub template: Vec<Need>,
    pub created_at: i64,
    pub review_until: i64,
    pub started_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub ended_at: Option<i64>,
    pub ended_by: Option<String>,
    pub kept: bool,
    pub grants: Vec<Grant>,
    pub feed: Vec<FeedItem>,
    pub prompts: Vec<PromptView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantChoice {
    #[serde(flatten)]
    pub need: Need,
    pub on: bool,
}

enum Answer {
    Deny,
    Allow { scope: Scope, method: &'static str },
}

struct Prompt {
    view: PromptView,
    raised: Instant,
    reply: Option<oneshot::Sender<Answer>>,
    held: String,
}

struct Session {
    view: SessionView,
    token: String,
    prompts: Vec<Prompt>,
    handling: HashSet<String>,
    stop: CancellationToken,
    tmp: PathBuf,
    saved_feed: usize,
    saved: bool,
}

#[derive(Default)]
struct State {
    sessions: HashMap<String, Session>,
    order: Vec<String>,
    next: u64,
}

impl State {
    fn next_id(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    fn event(&mut self, id: &str, text: String) {
        let n = self.next_id();
        if let Some(s) = self.sessions.get_mut(id) {
            s.view.feed.push(FeedItem::Event { id: n, at: now_ms(), text });
        }
    }
}

type Emit = Arc<dyn Fn(Vec<SessionView>) + Send + Sync>;

#[derive(Clone)]
pub struct Manager {
    relay: Relay,
    state: Arc<Mutex<State>>,
    emit: Emit,
    store: Option<Arc<Store>>,
}

struct Done {
    status: &'static str,
    output: Option<Value>,
    error: Option<String>,
}

impl Done {
    fn rejected(e: String) -> Self {
        Done { status: "rejected", output: None, error: Some(e) }
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

fn page(s: &str, from: usize) -> Page {
    let floor = |mut i: usize| {
        i = i.min(s.len());
        while !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    };
    let (start, end) = (floor(from), floor(from.saturating_add(PAGE)));
    Page { text: s[start..end].to_string(), next: (end < s.len()).then_some(end) }
}

fn feed_output(tool: &str, v: &Value) -> Option<String> {
    let text = output_text(tool, v);
    (!text.is_empty()).then(|| clip(&text, FEED_OUTPUT))
}

fn output_text(tool: &str, v: &Value) -> String {
    match tool {
        "run_command" => {
            let out = v["stdout"].as_str().unwrap_or_default();
            let err = v["stderr"].as_str().unwrap_or_default();
            [out, err].iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join("\n")
        }
        "read_file" | "tail_log" => v["content"].as_str().unwrap_or_default().to_string(),
        "list_dir" => v["entries"]
            .as_array()
            .map(|es| es.iter().filter_map(|e| e["name"].as_str()).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default(),
        "list_processes" => v["processes"]
            .as_array()
            .map(|ps| ps.iter().map(|p| format!("{} {}", p["pid"], p["name"].as_str().unwrap_or_default())).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default(),
        "write_file" => format!("wrote {} bytes", v["bytes"]),
        _ => String::new(),
    }
}

fn session_tmp(id: &str) -> std::io::Result<PathBuf> {
    use std::os::unix::fs::DirBuilderExt;
    let short: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(12).collect();
    let dir = std::env::temp_dir().join(format!("valet-{short}-{}", now_ms()));
    std::fs::DirBuilder::new().mode(0o700).create(&dir)?;
    std::fs::canonicalize(dir)
}

impl Manager {
    pub fn new(relay: Relay, emit: Emit, store: Option<Arc<Store>>) -> Self {
        let mut state = State::default();
        for view in store.as_ref().and_then(|s| s.load().ok()).unwrap_or_default() {
            state.order.push(view.id.clone());
            state.sessions.insert(
                view.id.clone(),
                Session {
                    saved_feed: view.feed.len(),
                    view,
                    token: String::new(),
                    prompts: vec![],
                    handling: HashSet::new(),
                    stop: CancellationToken::new(),
                    tmp: PathBuf::new(),
                    saved: true,
                },
            );
        }
        Self { relay, state: Arc::new(Mutex::new(state)), emit, store }
    }

    pub fn keep(&self, id: &str, kept: bool) {
        let found = self.lock().sessions.get_mut(id).map(|s| s.view.kept = kept).is_some();
        if let (true, Some(store)) = (found, &self.store) {
            let _ = store.set_kept(id, kept);
        }
        if found {
            (self.emit)(self.snapshot());
        }
    }

    // Only finished sessions; a live one keeps its record until it ends.
    pub fn forget(&self, which: impl Fn(&SessionView) -> bool) -> usize {
        let gone: Vec<String> = {
            let mut st = self.lock();
            let gone: Vec<String> =
                st.sessions.values().filter(|s| s.view.phase == Phase::Ended && which(&s.view)).map(|s| s.view.id.clone()).collect();
            for id in &gone {
                st.sessions.remove(id);
            }
            st.order.retain(|o| !gone.contains(o));
            gone
        };
        if let Some(store) = &self.store {
            for id in &gone {
                let _ = store.forget(id);
            }
        }
        if !gone.is_empty() {
            (self.emit)(self.snapshot());
        }
        gone.len()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn snapshot(&self) -> Vec<SessionView> {
        let st = self.lock();
        st.order
            .iter()
            .filter_map(|id| st.sessions.get(id))
            .map(|s| {
                let mut v = s.view.clone();
                v.prompts = s.prompts.iter().map(|p| p.view.clone()).collect();
                v
            })
            .collect()
    }

    fn changed(&self) {
        self.persist();
        (self.emit)(self.snapshot());
    }

    fn persist(&self) {
        let Some(store) = &self.store else { return };
        let writes: Vec<(SessionView, Vec<FeedItem>)> = {
            let mut st = self.lock();
            st.sessions
                .values_mut()
                .filter(|s| !s.saved)
                .map(|s| {
                    let fresh = s.view.feed[s.saved_feed..].to_vec();
                    s.saved_feed = s.view.feed.len();
                    s.saved = s.view.phase == Phase::Ended;
                    let mut v = s.view.clone();
                    v.feed.clear();
                    (v, fresh)
                })
                .collect()
        };
        for (view, fresh) in writes {
            let _ = store.save(&view, &fresh);
        }
    }

    fn token(&self, id: &str) -> Result<String, String> {
        self.lock().sessions.get(id).map(|s| s.token.clone()).ok_or_else(|| "That session isn't open.".into())
    }

    fn phase(&self, id: &str) -> Option<Phase> {
        self.lock().sessions.get(id).map(|s| s.view.phase)
    }

    pub async fn join(&self, code: &str) -> Result<SessionView, String> {
        let j = self.relay.join(code).await.map_err(|e| e.to_string())?;
        let tmp = session_tmp(&j.session_id).map_err(|e| e.to_string())?;
        let view = SessionView {
            id: j.session_id.clone(),
            phase: Phase::Joined,
            sender_name: j.sender_name,
            purpose: j.purpose,
            verified: false,
            template: j.template.into_iter().map(|mut n| {
                n.scope = normalise_scope(&n.scope);
                rate(n)
            }).collect(),
            created_at: j.created_at,
            review_until: j.review_until,
            started_at: None,
            ends_at: None,
            ended_at: None,
            ended_by: None,
            kept: false,
            grants: vec![],
            feed: vec![],
            prompts: vec![],
        };
        {
            let mut st = self.lock();
            st.order.insert(0, j.session_id.clone());
            st.sessions.insert(
                j.session_id.clone(),
                Session {
                    view: view.clone(),
                    token: j.client_token,
                    prompts: vec![],
                    handling: HashSet::new(),
                    stop: CancellationToken::new(),
                    tmp,
                    saved_feed: 0,
                    saved: false,
                },
            );
        }
        self.changed();
        Ok(view)
    }

    pub async fn decline(&self, id: &str) -> Result<(), String> {
        let token = self.token(id)?;
        if self.phase(id) != Some(Phase::Joined) {
            return Err("Only a session you haven't started can be declined.".into());
        }
        let result = self.relay.decline(id, &token).await;
        self.close(id, Phase::Declined, None);
        result.map(|_| ()).map_err(|e| e.to_string())
    }

    pub async fn start(&self, id: &str, choices: Vec<GrantChoice>) -> Result<(), String> {
        let token = self.token(id)?;
        if self.phase(id) != Some(Phase::Joined) {
            return Err("This session has already started or ended.".into());
        }
        let choices: Vec<(bool, Need)> = choices
            .into_iter()
            .take(MAX_GRANTS)
            .map(|c| {
                let mut need = c.need;
                need.scope = normalise_scope(&need.scope);
                (c.on, rate(need))
            })
            .collect();
        if choices.iter().any(|(on, n)| *on && n.risk >= Risk::High) {
            let agent = self.lock().sessions.get(id).map(|s| s.view.sender_name.clone()).unwrap_or_default();
            approve::confirm(&format!("start a session where {} can do high-risk actions without asking", clip(&agent, 40))).await?;
        }
        let grants: Vec<Grant> = {
            let mut st = self.lock();
            choices
                .into_iter()
                .map(|(on, need)| {
                    let n = st.next_id();
                    Grant { id: format!("g{n}"), on, source: Source::Proposed, need, expires_at: None }
                })
                .collect()
        };
        let started = self.relay.start(id, &token, &grants).await.map_err(|e| e.to_string())?;
        let count = grants.iter().filter(|g| g.on).count();
        {
            let mut st = self.lock();
            let Some(s) = st.sessions.get_mut(id) else { return Ok(()) };
            s.view.phase = Phase::Live;
            s.view.started_at = Some(now_ms());
            s.view.ends_at = Some(started.ends_at);
            s.view.grants = grants;
            let plural = if count == 1 { "permission" } else { "permissions" };
            st.event(id, format!("Session started with {count} {plural}"));
        }
        self.changed();
        let me = self.clone();
        let id = id.to_string();
        tokio::spawn(async move { me.poll(id).await });
        Ok(())
    }

    pub async fn extend(&self, id: &str) -> Result<(), String> {
        let token = self.token(id)?;
        let started = self.relay.extend(id, &token).await.map_err(|e| e.to_string())?;
        {
            let mut st = self.lock();
            if let Some(s) = st.sessions.get_mut(id) {
                s.view.ends_at = Some(started.ends_at);
            }
            st.event(id, "Added 15 minutes".into());
        }
        self.changed();
        Ok(())
    }

    pub async fn end(&self, id: &str) -> Result<(), String> {
        let token = self.token(id)?;
        let phase = self.phase(id);
        if phase == Some(Phase::Joined) {
            return self.decline(id).await;
        }
        if phase != Some(Phase::Live) {
            return Ok(());
        }
        self.close(id, Phase::Ended, Some("client".into()));
        self.relay.end(id, &token).await.map(|_| ()).map_err(|e| e.to_string())
    }

    pub async fn end_all(&self) {
        let ids: Vec<String> = {
            let st = self.lock();
            st.sessions.values().filter(|s| matches!(s.view.phase, Phase::Joined | Phase::Live)).map(|s| s.view.id.clone()).collect()
        };
        for id in ids {
            let _ = self.end(&id).await;
        }
    }

    pub fn set_grant(&self, id: &str, grant_id: &str, on: bool) -> Result<(), String> {
        let (token, grants) = {
            let mut st = self.lock();
            let s = st.sessions.get_mut(id).ok_or("That session isn't open.")?;
            if s.view.phase != Phase::Live {
                return Err("This session isn't live.".into());
            }
            let g = s.view.grants.iter_mut().find(|g| g.id == grant_id).ok_or("No such permission.")?;
            g.on = on;
            (s.token.clone(), s.view.grants.clone())
        };
        self.changed();
        self.mirror(id, token, grants);
        Ok(())
    }

    fn mirror(&self, id: &str, token: String, grants: Vec<Grant>) {
        let relay = self.relay.clone();
        let id = id.to_string();
        tokio::spawn(async move {
            let _ = relay.grants(&id, &token, &grants).await;
        });
    }

    fn close(&self, id: &str, phase: Phase, by: Option<String>) {
        let tmp = {
            let mut st = self.lock();
            let Some(s) = st.sessions.get_mut(id) else { return };
            if matches!(s.view.phase, Phase::Ended | Phase::Declined) {
                return;
            }
            s.view.phase = phase;
            s.view.ended_at = Some(now_ms());
            s.view.ended_by = by.clone();
            s.stop.cancel();
            s.prompts.clear();
            s.view.grants.iter_mut().for_each(|g| g.on = false);
            let tmp = s.tmp.clone();
            let sender = s.view.sender_name.clone();
            if phase == Phase::Ended {
                let text = match by.as_deref() {
                    Some("client") => "You ended the session".to_string(),
                    Some("agent") => format!("{sender} ended the session"),
                    Some("time") => "The session reached its time limit".to_string(),
                    _ => "The session ended".to_string(),
                };
                st.event(id, text);
            }
            if phase == Phase::Declined {
                st.order.retain(|o| o != id);
                st.sessions.remove(id);
                if let Some(store) = &self.store {
                    let _ = store.forget(id);
                }
            }
            tmp
        };
        let _ = std::fs::remove_dir_all(tmp);
        self.changed();
    }

    pub fn output_page(&self, prompt_id: &str, from: usize) -> Result<Page, String> {
        let st = self.lock();
        let p = st
            .sessions
            .values()
            .flat_map(|s| &s.prompts)
            .find(|p| p.view.id == prompt_id)
            .ok_or("That request is no longer waiting.")?;
        Ok(page(&p.held, from))
    }

    pub async fn answer(&self, prompt_id: &str, allow: bool, scope: Option<Scope>) -> Result<(), String> {
        let (id, scope, literal, agent) = {
            let mut st = self.lock();
            let (id, s) = st
                .sessions
                .iter_mut()
                .find(|(_, s)| s.prompts.iter().any(|p| p.view.id == prompt_id))
                .ok_or("That request is no longer waiting.")?;
            let id = id.clone();
            let agent = s.view.sender_name.clone();
            let i = s.prompts.iter().position(|p| p.view.id == prompt_id).unwrap();
            let p = &mut s.prompts[i];
            if p.view.busy {
                return Err("That request is already being answered.".into());
            }
            if !allow {
                let p = s.prompts.remove(i);
                if let Some(tx) = p.reply {
                    let _ = tx.send(Answer::Deny);
                }
                drop(st);
                self.changed();
                return Ok(());
            }
            if p.raised.elapsed() < ARMING {
                return Err("Wait a moment before allowing.".into());
            }
            if p.view.output.is_some() {
                let p = s.prompts.remove(i);
                if let Some(tx) = p.reply {
                    let _ = tx.send(Answer::Allow { scope: Scope::Once, method: "click" });
                }
                drop(st);
                self.changed();
                return Ok(());
            }
            let scope = scope.ok_or("Choose how long to allow it for.")?;
            if !p.view.scopes.contains(&scope) {
                return Err("That choice isn't available for this request.".into());
            }
            let risk = p.view.risk;
            if risk < Risk::High {
                let p = s.prompts.remove(i);
                if let Some(tx) = p.reply {
                    let _ = tx.send(Answer::Allow { scope, method: "click" });
                }
                drop(st);
                self.changed();
                return Ok(());
            }
            p.view.busy = true;
            (id, scope, p.view.literal.clone(), agent)
        };
        self.changed();
        let reason = format!("allow {} to {}", clip(&agent, 40), clip(&literal, 80));
        let confirmed = approve::confirm(&reason).await;
        {
            let mut st = self.lock();
            let Some(s) = st.sessions.get_mut(&id) else { return Ok(()) };
            let Some(i) = s.prompts.iter().position(|p| p.view.id == prompt_id) else { return Ok(()) };
            if let Err(e) = confirmed {
                s.prompts[i].view.busy = false;
                drop(st);
                self.changed();
                return Err(e);
            }
            let p = s.prompts.remove(i);
            if let Some(tx) = p.reply {
                let _ = tx.send(Answer::Allow { scope, method: "touch_id" });
            }
        }
        self.changed();
        Ok(())
    }

    async fn poll(&self, id: String) {
        let Ok(token) = self.token(&id) else { return };
        let stop = match self.lock().sessions.get(&id) {
            Some(s) => s.stop.clone(),
            None => return,
        };
        let mut after = 0;
        let mut backoff = Duration::from_secs(1);
        loop {
            let ends_at = self.lock().sessions.get(&id).and_then(|s| s.view.ends_at).unwrap_or(0);
            let left = Duration::from_millis((ends_at - now_ms()).max(0) as u64);
            let reply = tokio::select! {
                r = self.relay.inbox(&id, &token, after, 50) => r,
                _ = tokio::time::sleep(left) => {
                    self.close(&id, Phase::Ended, Some("time".into()));
                    let _ = self.relay.end(&id, &token).await;
                    return;
                }
                _ = stop.cancelled() => return,
            };
            match reply {
                Ok(inbox) => {
                    backoff = Duration::from_secs(1);
                    if inbox.state != "live" {
                        let by = self.relay.status(&id, &token).await.ok().and_then(|s| s.ended_by);
                        self.close(&id, Phase::Ended, by);
                        return;
                    }
                    if let Some(at) = inbox.ends_at {
                        if let Some(s) = self.lock().sessions.get_mut(&id) {
                            s.view.ends_at = Some(at);
                        }
                    }
                    for a in inbox.actions {
                        after = after.max(a.seq);
                        if a.status != "pending" {
                            continue;
                        }
                        let fresh = self.lock().sessions.get_mut(&id).is_some_and(|s| s.handling.insert(a.action_id.clone()));
                        if fresh {
                            let me = self.clone();
                            let id = id.clone();
                            tokio::spawn(async move { me.handle(id, a).await });
                        }
                    }
                }
                Err(e) if matches!(e.status(), Some(401 | 403 | 404 | 410)) => {
                    self.close(&id, Phase::Ended, None);
                    return;
                }
                Err(_) => {
                    tokio::select! {
                        _ = tokio::time::sleep(backoff) => {}
                        _ = stop.cancelled() => return,
                    }
                    backoff = (backoff * 2).min(Duration::from_secs(15));
                }
            }
        }
    }

    async fn handle(&self, id: String, a: InboxAction) {
        let planned = Request::parse(&a.tool, &a.args).and_then(plan);
        let (done, literal, diff, method) = match planned {
            Err(e) => (Some(Done::rejected(e)), a.tool.clone(), None, None),
            Ok(p) => {
                let diff = match &p.request {
                    Request::WriteFile { content, .. } => {
                        let old = p.path.as_ref().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
                        Some(tools::diff(&old, content))
                    }
                    _ => None,
                };
                let (done, method) = self.decide_and_run(&id, &a, &p, diff.clone()).await;
                (done, p.literal.clone(), diff, method)
            }
        };
        let Some(done) = done else { return };
        let outcome = match done.status {
            "ok" => "Allowed",
            "approved" => "Approved",
            "denied" => "Denied",
            "rejected" => "Rejected",
            _ => "Failed",
        };
        let output = done.output.as_ref().and_then(|v| feed_output(&a.tool, v));
        let token = {
            let mut st = self.lock();
            let n = st.next_id();
            let Some(s) = st.sessions.get_mut(&id) else { return };
            s.view.feed.push(FeedItem::Action {
                id: n,
                at: now_ms(),
                tool: a.tool.clone(),
                literal,
                outcome: outcome.into(),
                method: method.map(|m: &str| if m == "touch_id" { "Touch ID".to_string() } else { "Click".to_string() }),
                output,
                diff,
                note: done.error.clone(),
            });
            s.token.clone()
        };
        self.changed();
        let mut body = json!({ "status": done.status });
        if let Some(out) = &done.output {
            if let Some(h) = out["hash"].as_str() {
                body["hash"] = h.into();
            }
            body["output"] = out.clone();
        }
        if let Some(e) = done.error {
            body["error"] = clip(&e, 1900).into();
        }
        if let Some(m) = method {
            body["method"] = m.into();
        }
        let _ = self.post(&id, &token, &a.action_id, &body).await;
    }

    async fn post(&self, id: &str, token: &str, aid: &str, body: &Value) -> Result<(), RelayError> {
        for wait in [1, 2, 4] {
            match self.relay.result(id, token, aid, body).await {
                Ok(_) => return Ok(()),
                Err(e) if e.status().is_some() => return Err(e),
                Err(_) => tokio::time::sleep(Duration::from_secs(wait)).await,
            }
        }
        self.relay.result(id, token, aid, body).await.map(|_| ())
    }

    async fn decide_and_run(&self, id: &str, a: &InboxAction, p: &Plan, diff: Option<Vec<String>>) -> (Option<Done>, Option<&'static str>) {
        let (grants, stop, tmp) = {
            let st = self.lock();
            let Some(s) = st.sessions.get(id) else { return (None, None) };
            (s.view.grants.clone(), s.stop.clone(), s.tmp.clone())
        };
        let asked = decide(p.risk, &p.needs, &grants, now_ms());
        if let Request::WriteFile { base_hash, .. } = &p.request {
            let current = p.path.as_deref().map(tools::file_hash);
            if !matches!(current, Some(Ok(ref h)) if h == base_hash) {
                return (Some(Done::rejected(format!("{} changed after it was last read. Read it again first.", p.literal))), None);
            }
        }
        let mut method = None;
        let mut approved = vec![];
        let mut check = false;
        if !asked.is_empty() {
            let (tx, rx) = oneshot::channel();
            {
                let mut st = self.lock();
                let n = st.next_id();
                let Some(s) = st.sessions.get_mut(id) else { return (None, None) };
                s.prompts.push(Prompt {
                    view: PromptView {
                        id: format!("p{n}"),
                        tool: a.tool.clone(),
                        literal: p.literal.clone(),
                        program: p.program.as_ref().map(|x| x.display().to_string()),
                        cwd: p.cwd.as_deref().map(tilde),
                        needs: asked.clone(),
                        risk: p.risk,
                        reason: a.reason.clone(),
                        scopes: scopes_for(p.risk, &asked),
                        asked_at: now_ms(),
                        diff,
                        output: None,
                        output_next: None,
                        busy: false,
                    },
                    raised: Instant::now(),
                    reply: Some(tx),
                    held: String::new(),
                });
            }
            self.changed();
            let answer = tokio::select! {
                r = rx => r.ok(),
                _ = stop.cancelled() => None,
            };
            match answer {
                None => return (None, None),
                Some(Answer::Deny) => {
                    return (Some(Done { status: "denied", output: None, error: None }), Some("click"));
                }
                Some(Answer::Allow { scope, method: m }) => {
                    method = Some(m);
                    approved = asked.clone();
                    check = scope == Scope::Check;
                    self.add_grants(id, &asked, scope);
                }
            }
        }
        let mut done = self.execute(id, p, &approved, &tmp, &stop).await;
        if let (true, Some(d)) = (check, &done) {
            let text = d.output.as_ref().map(|v| output_text(&a.tool, v)).filter(|t| !t.is_empty()).or(d.error.clone()).unwrap_or_default();
            match self.hold(id, a, p, text, &stop).await {
                None => return (None, None),
                Some(false) => done = Some(Done { status: "denied", output: None, error: Some("The output was checked and not sent.".into()) }),
                Some(true) => {}
            }
        }
        let done = done.map(|mut d| {
            if method.is_some() && d.status == "ok" {
                d.status = "approved";
            }
            d
        });
        (done, method)
    }

    async fn hold(&self, id: &str, a: &InboxAction, p: &Plan, output: String, stop: &CancellationToken) -> Option<bool> {
        let (tx, rx) = oneshot::channel();
        let first = page(&output, 0);
        {
            let mut st = self.lock();
            let n = st.next_id();
            let s = st.sessions.get_mut(id)?;
            s.prompts.push(Prompt {
                view: PromptView {
                    id: format!("p{n}"),
                    tool: a.tool.clone(),
                    literal: p.literal.clone(),
                    program: None,
                    cwd: None,
                    needs: vec![],
                    risk: p.risk,
                    reason: a.reason.clone(),
                    scopes: vec![],
                    asked_at: now_ms(),
                    diff: None,
                    output: Some(first.text),
                    output_next: first.next,
                    busy: false,
                },
                raised: Instant::now(),
                reply: Some(tx),
                held: output,
            });
        }
        self.changed();
        tokio::select! {
            r = rx => r.ok().map(|a| matches!(a, Answer::Allow { .. })),
            _ = stop.cancelled() => None,
        }
    }

    fn add_grants(&self, id: &str, needs: &[Need], scope: Scope) {
        let added = grants_from(needs, scope, now_ms());
        if added.is_empty() {
            return;
        }
        let (token, grants) = {
            let mut st = self.lock();
            let ids: Vec<u64> = added.iter().map(|_| st.next_id()).collect();
            let Some(s) = st.sessions.get_mut(id) else { return };
            for ((need, expires_at), n) in added.into_iter().zip(ids) {
                s.view.grants.push(Grant { id: format!("a{n}"), on: true, source: Source::Approved, need, expires_at });
            }
            (s.token.clone(), s.view.grants.clone())
        };
        self.mirror(id, token, grants);
    }

    async fn execute(&self, id: &str, p: &Plan, approved: &[Need], tmp: &std::path::Path, stop: &CancellationToken) -> Option<Done> {
        if let Request::RunCommand { command, .. } = &p.request {
            let grants = self.lock().sessions.get(id).map(|s| s.view.grants.clone()).unwrap_or_default();
            let program = p.program.clone()?;
            return match sandbox::run(&program, command, p.cwd.as_deref(), &grants, approved, tmp, stop).await {
                Ran::Done(v) => Some(Done { status: "ok", output: Some(v), error: None }),
                Ran::Blocked(v) => Some(Done {
                    status: "denied",
                    output: Some(v),
                    error: Some("sandbox: the command tried to use something this session doesn't allow. Ask for it with a structured tool, or ask your user.".into()),
                }),
                Ran::Failed(e) => Some(Done { status: "failed", output: None, error: Some(e) }),
                Ran::Stopped => None,
            };
        }
        let request = p.request.clone();
        let path = p.path.clone();
        let result = tokio::task::spawn_blocking(move || {
            let path = path.as_deref();
            match (&request, path) {
                (Request::ReadFile { path: raw, max_bytes }, Some(f)) => tools::read_file(raw, f, *max_bytes),
                (Request::TailLog { path: raw, lines }, Some(f)) => tools::tail_log(raw, f, *lines),
                (Request::WriteFile { path: raw, content, base_hash }, Some(f)) => tools::write_file(raw, f, content, base_hash),
                (Request::ListDir { path: raw }, Some(f)) => tools::list_dir(raw, f),
                (Request::ListProcesses {}, _) => tools::list_processes(),
                _ => Err(Failure::Rejected("The request is malformed.".into())),
            }
        })
        .await
        .unwrap_or_else(|e| Err(Failure::Failed(e.to_string())));
        Some(match result {
            Ok(v) => Done { status: "ok", output: Some(v), error: None },
            Err(Failure::Rejected(e)) => Done::rejected(e),
            Err(Failure::Failed(e)) => Done { status: "failed", output: None, error: Some(e) },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Agent {
        http: reqwest::Client,
        api: String,
        id: String,
        token: String,
    }

    impl Agent {
        async fn act(&self, tool: &str, args: Value) -> Value {
            let n = now_ms();
            let body = json!({ "tool": tool, "args": args, "reason": "End-to-end test.", "client_id": format!("test-{n}-{tool}") });
            let url = format!("{}/sessions/{}/actions", self.api, self.id);
            let r: Value = self.http.post(url).bearer_auth(&self.token).json(&body).send().await.unwrap().json().await.unwrap();
            r["action_id"].as_str().unwrap_or_else(|| panic!("no action id: {r}")).to_string().into()
        }

        async fn result(&self, aid: &Value) -> Value {
            let url = format!("{}/sessions/{}/actions/{}?wait=20", self.api, self.id, aid.as_str().unwrap());
            self.http.get(url).bearer_auth(&self.token).send().await.unwrap().json().await.unwrap()
        }
    }

    #[test]
    fn forgets_only_the_finished_sessions_asked_for() {
        let store = Arc::new(Store::memory());
        for (id, ended_at) in [("old", 5), ("new", 50), ("kept", 5)] {
            let view = SessionView {
                id: id.into(),
                phase: Phase::Ended,
                sender_name: "Acme".into(),
                purpose: "Fix it.".into(),
                verified: false,
                template: vec![],
                created_at: 1,
                review_until: 2,
                started_at: Some(3),
                ends_at: Some(60),
                ended_at: Some(ended_at),
                ended_by: Some("client".into()),
                kept: id == "kept",
                grants: vec![],
                feed: vec![],
                prompts: vec![],
            };
            store.save(&view, &[]).unwrap();
            store.set_kept(id, view.kept).unwrap();
        }
        let m = Manager::new(Relay::new("http://localhost:9"), Arc::new(|_| {}), Some(store.clone()));
        assert_eq!(m.forget(|v| !v.kept && v.ended_at < Some(10)), 1);
        let ids = |vs: Vec<SessionView>| {
            let mut ids = vs.into_iter().map(|v| v.id).collect::<Vec<_>>();
            ids.sort();
            ids
        };
        assert_eq!(ids(m.snapshot()), ["kept", "new"]);
        assert_eq!(ids(store.load().unwrap()), ["kept", "new"]);
        m.keep("kept", false);
        assert!(!store.load().unwrap().iter().any(|v| v.kept));
        assert_eq!(m.forget(|_| true), 2);
        assert!(m.snapshot().is_empty());
    }

    #[test]
    fn pages_cover_the_output_on_char_boundaries() {
        let text = "é".repeat(PAGE);
        let mut got = String::new();
        let mut from = Some(0);
        while let Some(f) = from {
            let p = page(&text, f);
            got += &p.text;
            from = p.next;
        }
        assert_eq!(got, text);
        assert_eq!(page("", 0).next, None);
    }

    async fn prompt(m: &Manager) -> PromptView {
        for _ in 0..200 {
            if let Some(p) = m.snapshot().into_iter().flat_map(|s| s.prompts).next() {
                tokio::time::sleep(Duration::from_millis(700)).await;
                return p;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("no prompt was raised");
    }

    #[tokio::test]
    #[ignore = "needs a local relay in VALET_TEST_RELAY"]
    async fn a_session_runs_end_to_end() {
        let base = std::env::var("VALET_TEST_RELAY").expect("VALET_TEST_RELAY");
        let api = format!("{}/api/v1", base.trim_end_matches('/'));
        let dir = session_tmp("e2e-files").unwrap();
        let file = dir.join("config.json");
        std::fs::write(&file, "{ \"renderer\": \"opengl\" }\n").unwrap();
        let http = reqwest::Client::new();
        let template = json!([
            { "kind": "Files", "access": "read", "scope": format!("{}/**", dir.display()), "risk": "low" },
            { "kind": "Programs", "access": "run", "scope": "/usr/bin/uname", "risk": "medium" },
            { "kind": "Processes", "access": "list", "scope": "all", "risk": "low" }
        ]);
        let created: Value = http
            .post(format!("{api}/sessions"))
            .json(&json!({ "name": "Test vendor", "purpose": "End-to-end test.", "template": template }))
            .send().await.unwrap().json().await.unwrap();
        let agent = Agent {
            http: http.clone(),
            api: api.clone(),
            id: created["session_id"].as_str().unwrap().into(),
            token: created["agent_token"].as_str().unwrap().into(),
        };

        let store = Arc::new(Store::memory());
        let m = Manager::new(Relay::new(&base), Arc::new(|_| {}), Some(store.clone()));
        let joined = m.join(created["code"].as_str().unwrap()).await.unwrap();
        assert_eq!(joined.sender_name, "Test vendor");
        let choices: Vec<GrantChoice> = serde_json::from_value(template.as_array().unwrap().iter().map(|n| {
            let mut n = n.clone();
            n["on"] = true.into();
            n
        }).collect()).unwrap();
        m.start(&joined.id, choices).await.unwrap();

        let r = agent.result(&agent.act("list_processes", json!({})).await).await;
        assert_eq!(r["status"], "ok", "{r}");

        let r = agent.result(&agent.act("read_file", json!({ "path": file })).await).await;
        assert_eq!(r["status"], "ok", "{r}");
        let hash = r["output"]["hash"].as_str().unwrap().to_string();

        let r = agent.result(&agent.act("run_command", json!({ "command": ["/usr/bin/uname"] })).await).await;
        assert_eq!(r["output"]["stdout"], "Darwin\n", "{r}");

        let aid = agent.act("write_file", json!({ "path": file, "content": "{ \"renderer\": \"metal\" }\n", "base_hash": hash })).await;
        let p = prompt(&m).await;
        assert_eq!(p.diff.as_deref().unwrap(), ["-{ \"renderer\": \"opengl\" }", "+{ \"renderer\": \"metal\" }"]);
        assert!(m.answer(&p.id, true, Some(Scope::Session)).await.is_ok());
        let r = agent.result(&aid).await;
        assert_eq!((r["status"].as_str(), r["method"].as_str()), (Some("approved"), Some("click")), "{r}");
        let hash = r["output"]["hash"].as_str().unwrap().to_string();

        let r = agent.result(&agent.act("write_file", json!({ "path": file, "content": "{}\n", "base_hash": hash })).await).await;
        assert_eq!(r["status"], "ok", "a session approval should cover the next write: {r}");
        let r = agent.result(&agent.act("write_file", json!({ "path": file, "content": "{}\n", "base_hash": hash })).await).await;
        assert_eq!(r["status"], "rejected", "a stale hash must be turned back: {r}");

        let aid = agent.act("run_command", json!({ "command": ["/bin/ls", crate::needs::home()] })).await;
        let p = prompt(&m).await;
        assert!(m.answer(&p.id, true, Some(Scope::Once)).await.is_ok());
        let r = agent.result(&aid).await;
        assert_eq!(r["status"], "denied", "the sandbox should stop ls reading the home folder: {r}");

        let aid = agent.act("run_command", json!({ "command": ["/usr/bin/whoami"] })).await;
        let p = prompt(&m).await;
        assert!(m.answer(&p.id, true, Some(Scope::Folder)).await.is_err(), "a program has no folder scope");
        assert!(m.answer(&p.id, false, None).await.is_ok());
        assert!(m.answer(&p.id, false, None).await.is_err(), "a request is answered once");
        assert_eq!(agent.result(&aid).await["status"], "denied");

        let aid = agent.act("run_command", json!({ "command": ["/usr/bin/whoami"] })).await;
        assert!(m.answer(&prompt(&m).await.id, true, Some(Scope::Check)).await.is_ok());
        let p = prompt(&m).await;
        assert!(p.output.is_some(), "the result is held for a check");
        assert!(m.answer(&p.id, false, None).await.is_ok());
        let r = agent.result(&aid).await;
        assert!(r["status"] == "denied" && r["output"].is_null(), "{r}");

        let aid = agent.act("run_command", json!({ "command": ["/usr/bin/whoami"] })).await;
        assert!(m.answer(&prompt(&m).await.id, true, Some(Scope::Check)).await.is_ok());
        assert!(m.answer(&prompt(&m).await.id, true, None).await.is_ok());
        assert_eq!(agent.result(&aid).await["status"], "approved");

        let r = agent.result(&agent.act("read_file", json!({ "path": "~/../etc/passwd" })).await).await;
        assert_eq!(r["status"], "rejected", "{r}");

        http.post(format!("{api}/sessions/{}/end", agent.id)).bearer_auth(&agent.token).send().await.unwrap();
        for _ in 0..100 {
            if m.snapshot()[0].phase == Phase::Ended {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let s = &m.snapshot()[0];
        assert_eq!((s.phase, s.ended_by.as_deref()), (Phase::Ended, Some("agent")));
        assert!(s.grants.iter().all(|g| !g.on));

        let reopened = Manager::new(Relay::new(&base), Arc::new(|_| {}), Some(store)).snapshot();
        assert_eq!((reopened.len(), reopened[0].feed.len()), (1, s.feed.len()), "the record should outlive the app");
        assert!(reopened[0].feed.iter().all(|f| !matches!(f, FeedItem::Action { output: Some(_), .. })));
        let _ = std::fs::remove_dir_all(dir);
    }
}
