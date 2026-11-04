use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio_util::sync::CancellationToken;

use crate::needs::{home, protected_roots, SEARCH_PATH};
use crate::types::{now_ms, Grant, Kind, Need, Source};

const OUTPUT_CAP: usize = 256 * 1024;
const WALL_LIMIT: Duration = Duration::from_secs(300);
const CPU_SECONDS: libc::rlim_t = 300;
const FILE_BYTES: libc::rlim_t = 256 * 1024 * 1024;

const BASE: &str = r#"(version 1)
(deny default)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow user-preference-read)
(allow iokit-open (iokit-user-client-class "RootDomainUserClient"))
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.SystemConfiguration.configd")
  (global-name "com.apple.CoreServices.coreservicesd")
  (global-name "com.apple.system.DirectoryService.libinfo_v1")
  (global-name "com.apple.trustd.agent"))
(allow ipc-posix-shm-read-data (ipc-posix-name "apple.shm.notification_center"))
(allow file-read*
  (literal "/")
  (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/System")
  (subpath "/Library/Apple") (subpath "/Library/Preferences")
  (subpath "/private/etc") (subpath "/private/var/select")
  (subpath "/private/var/db/dyld") (subpath "/private/var/db/timezone")
  (subpath "/dev") (subpath "/opt/homebrew") (subpath "/usr/local"))
(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper"))
(allow file-ioctl (literal "/dev/dtracehelper"))
"#;

const NETWORK: &str = r#"(allow network-outbound)
(allow system-socket)
(allow mach-lookup
  (global-name "com.apple.dnssd.service")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.networkd")
  (global-name "com.apple.mDNSResponder"))
"#;

fn quoted(p: &Path) -> String {
    format!("\"{}\"", p.display().to_string().replace('\\', "\\\\").replace('"', "\\\""))
}

fn filter(scope: &str) -> Option<String> {
    if scope == "*" {
        return Some("(subpath \"/\")".into());
    }
    let (base, glob) = match scope.strip_suffix("/**") {
        Some(b) => (b, true),
        None => (scope, false),
    };
    let p = if base == "~" {
        home()
    } else if let Some(rest) = base.strip_prefix("~/") {
        home().join(rest)
    } else if base.starts_with('/') {
        PathBuf::from(base)
    } else {
        return None;
    };
    Some(format!("({} {})", if glob { "subpath" } else { "literal" }, quoted(&p)))
}

struct Allowed<'a> {
    need: &'a Need,
    approved: bool,
}

pub fn profile(grants: &[Grant], approved: &[Need], program: &Path, tmp: &Path) -> String {
    let now = now_ms();
    let live: Vec<Allowed> = grants
        .iter()
        .filter(|g| g.on && g.expires_at.is_none_or(|at| at >= now))
        .map(|g| Allowed { need: &g.need, approved: g.source == Source::Approved })
        .chain(approved.iter().map(|n| Allowed { need: n, approved: true }))
        .collect();
    let files = |access: &[&str], only_approved: bool| -> Vec<String> {
        live.iter()
            .filter(|a| a.need.kind == Kind::Files && access.contains(&a.need.access.as_str()))
            .filter(|a| !only_approved || a.approved)
            .filter_map(|a| filter(&a.need.scope))
            .collect()
    };

    let mut sb = String::from(BASE);
    let t = quoted(tmp);
    sb += &format!("(allow file-read* file-write* (subpath {t}))\n");

    let mut exec = vec![program.to_path_buf()];
    let mut any_program = false;
    for a in live.iter().filter(|a| a.need.kind == Kind::Programs && a.need.access == "run") {
        if a.need.scope == "*" {
            any_program = true;
        } else {
            exec.push(PathBuf::from(&a.need.scope));
        }
    }
    if exec.iter().any(|p| p == Path::new("/bin/sh")) {
        if let Ok(real) = std::fs::canonicalize("/private/var/select/sh") {
            exec.push(real);
        }
    }
    if any_program {
        sb += "(allow process-exec)\n";
    } else {
        let list: Vec<String> = exec.iter().map(|p| format!("(literal {})", quoted(p))).collect();
        sb += &format!("(allow process-exec {})\n", list.join(" "));
    }

    let reads = files(&["read", "write"], false);
    if !reads.is_empty() {
        sb += &format!("(allow file-read* {})\n", reads.join(" "));
    }
    let writes = files(&["write"], false);
    if !writes.is_empty() {
        sb += &format!("(allow file-write* {})\n", writes.join(" "));
    }

    let guarded: Vec<String> = protected_roots().iter().map(|p| format!("(subpath {})", quoted(p))).collect();
    sb += &format!("(deny file-read* file-write* {} (regex #\"/\\.env(\\.[^/]*)?$\"))\n", guarded.join(" "));
    let reads = files(&["read", "write"], true);
    if !reads.is_empty() {
        sb += &format!("(allow file-read* {})\n", reads.join(" "));
    }
    let writes = files(&["write"], true);
    if !writes.is_empty() {
        sb += &format!("(allow file-write* {})\n", writes.join(" "));
    }

    if live.iter().any(|a| a.need.kind == Kind::Network && a.approved) {
        sb += NETWORK;
    }
    sb
}

fn environment(grants: &[Grant], tmp: &Path) -> Vec<(String, String)> {
    let now = now_ms();
    let names: Vec<&str> = grants
        .iter()
        .filter(|g| g.on && g.need.kind == Kind::Environment && g.expires_at.is_none_or(|at| at >= now))
        .map(|g| g.need.scope.as_str())
        .collect();
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(k, _)| names.contains(&"*") || names.contains(&k.as_str()))
        .filter(|(k, _)| !k.starts_with("VALET_"))
        .collect();
    env.retain(|(k, _)| !["PATH", "HOME", "TMPDIR"].contains(&k.as_str()));
    env.push(("PATH".into(), SEARCH_PATH.join(":")));
    env.push(("HOME".into(), home().display().to_string()));
    env.push(("TMPDIR".into(), format!("{}/", tmp.display())));
    if !env.iter().any(|(k, _)| k == "LANG") {
        env.push(("LANG".into(), "en_US.UTF-8".into()));
    }
    env
}

async fn capture(mut r: impl AsyncRead + Unpin) -> (Vec<u8>, bool) {
    let mut kept = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    let mut truncated = false;
    while let Ok(n) = r.read(&mut chunk).await {
        if n == 0 {
            break;
        }
        let room = OUTPUT_CAP.saturating_sub(kept.len());
        kept.extend_from_slice(&chunk[..n.min(room)]);
        truncated |= n > room;
    }
    (kept, truncated)
}

fn kill_group(pgid: i32, signal: i32) {
    if pgid > 0 {
        unsafe {
            libc::killpg(pgid, signal);
        }
    }
}

pub enum Ran {
    Done(Value),
    Blocked(Value),
    Failed(String),
    Stopped,
}

pub async fn run(
    program: &Path,
    argv: &[String],
    cwd: Option<&Path>,
    grants: &[Grant],
    approved: &[Need],
    tmp: &Path,
    stop: &CancellationToken,
) -> Ran {
    let sb = profile(grants, approved, program, tmp);
    let mut cmd = tokio::process::Command::new("/usr/bin/sandbox-exec");
    cmd.arg("-p").arg(&sb).arg(program).args(&argv[1..]);
    cmd.env_clear().envs(environment(grants, tmp));
    cmd.current_dir(cwd.unwrap_or(tmp));
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.process_group(0).kill_on_drop(true);
    unsafe {
        cmd.pre_exec(|| {
            let cpu = libc::rlimit { rlim_cur: CPU_SECONDS, rlim_max: CPU_SECONDS };
            let fsize = libc::rlimit { rlim_cur: FILE_BYTES, rlim_max: FILE_BYTES };
            let core = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
            libc::setrlimit(libc::RLIMIT_CPU, &cpu);
            libc::setrlimit(libc::RLIMIT_FSIZE, &fsize);
            libc::setrlimit(libc::RLIMIT_CORE, &core);
            Ok(())
        });
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Ran::Failed(format!("Couldn't start the program: {e}")),
    };
    let pgid = child.id().map(|p| p as i32).unwrap_or(0);
    let out = tokio::spawn(capture(child.stdout.take().unwrap()));
    let err = tokio::spawn(capture(child.stderr.take().unwrap()));

    let status = tokio::select! {
        s = child.wait() => s.ok(),
        _ = tokio::time::sleep(WALL_LIMIT) => None,
        _ = stop.cancelled() => {
            kill_group(pgid, libc::SIGTERM);
            tokio::time::sleep(Duration::from_secs(2)).await;
            kill_group(pgid, libc::SIGKILL);
            return Ran::Stopped;
        }
    };
    kill_group(pgid, libc::SIGTERM);
    let Some(status) = status else {
        kill_group(pgid, libc::SIGKILL);
        return Ran::Failed("The command ran for 5 minutes and was stopped.".into());
    };
    let (stdout, t1) = out.await.unwrap_or_default();
    let (stderr, t2) = err.await.unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    let exit_code = status.code().unwrap_or(-1);
    let result = json!({
        "exit_code": exit_code,
        "stdout": String::from_utf8_lossy(&stdout),
        "stderr": stderr,
        "truncated": t1 || t2,
    });
    if exit_code == 71 && stderr.contains("execvp()") || exit_code != 0 && stderr.contains("Operation not permitted") {
        return Ran::Blocked(result);
    }
    Ran::Done(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Risk;

    fn grant(kind: Kind, access: &str, scope: &str, source: Source) -> Grant {
        Grant {
            id: "g".into(),
            on: true,
            source,
            need: Need { kind, access: access.into(), scope: scope.into(), risk: Risk::Low, protected_label: None },
            expires_at: None,
        }
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("valet-sb-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::canonicalize(d).unwrap()
    }

    async fn sh(script: &str, grants: &[Grant]) -> Ran {
        let argv = vec!["/bin/sh".into(), "-c".into(), script.into()];
        run(Path::new("/bin/sh"), &argv, None, grants, &[], &tmp(), &CancellationToken::new()).await
    }

    #[tokio::test]
    async fn runs_a_granted_program() {
        let argv = vec!["/usr/bin/uname".into()];
        let r = run(Path::new("/usr/bin/uname"), &argv, None, &[], &[], &tmp(), &CancellationToken::new()).await;
        let Ran::Done(v) = r else { panic!("uname did not run") };
        assert_eq!(v["stdout"], "Darwin\n");
    }

    #[tokio::test]
    async fn blocks_programs_and_files_not_granted() {
        let ls = [grant(Kind::Programs, "run", "/bin/ls", Source::Proposed)];
        assert!(matches!(sh("/usr/bin/whoami", &ls).await, Ran::Blocked(_)));
        assert!(matches!(sh("/bin/ls ~", &ls).await, Ran::Blocked(_)));
    }

    #[tokio::test]
    async fn protected_places_stay_closed_under_a_broad_grant() {
        let all = [grant(Kind::Files, "read", "~/**", Source::Proposed), grant(Kind::Programs, "run", "/bin/ls", Source::Proposed)];
        assert!(matches!(sh("/bin/ls ~/Library/Logs", &all).await, Ran::Done(_)));
        let r = sh("/bin/ls ~/.ssh", &all).await;
        assert!(matches!(r, Ran::Blocked(_)), "~/.ssh was readable");
    }

    #[tokio::test]
    async fn the_network_needs_an_approved_grant() {
        let curl = |grants: Vec<Grant>| async move {
            let argv: Vec<String> = ["/usr/bin/curl", "-sS", "-m", "5", "-o", "/dev/null", "https://example.com"].map(String::from).to_vec();
            run(Path::new("/usr/bin/curl"), &argv, None, &grants, &[], &tmp(), &CancellationToken::new()).await
        };
        let proposed = curl(vec![grant(Kind::Network, "connect", "*", Source::Proposed)]).await;
        assert!(!matches!(proposed, Ran::Done(ref v) if v["exit_code"] == 0));
    }

    #[tokio::test]
    async fn stopping_kills_the_process_group() {
        let stop = CancellationToken::new();
        let s = stop.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            s.cancel();
        });
        let argv = vec!["/bin/sh".into(), "-c".into(), "/bin/sleep 30 & /bin/sleep 30".into()];
        let sleep = grant(Kind::Programs, "run", "/bin/sleep", Source::Proposed);
        let started = std::time::Instant::now();
        let r = run(Path::new("/bin/sh"), &argv, None, &[sleep], &[], &tmp(), &stop).await;
        assert!(matches!(r, Ran::Stopped));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
