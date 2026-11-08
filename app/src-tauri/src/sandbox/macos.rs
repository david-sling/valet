use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::{capture, environment, live, Ran, CPU_SECONDS, WALL_LIMIT};
use crate::needs::{protected_roots, scope_path, scope_protects};
use crate::types::{Grant, Kind, Need};

// Large enough for a debug build's libraries (rustc writes 300 MB and more), small enough to stop a runaway write filling the disk
const FILE_BYTES: libc::rlim_t = 2 * 1024 * 1024 * 1024;
// <libproc.h>'s selector for one user's pids; libc has the call but not the constant
const PROC_UID_ONLY: u32 = 4;
const PROC_HEADROOM: libc::rlim_t = 256;

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
    let glob = scope.ends_with("/**");
    let p = scope_path(scope)?;
    Some(format!("({} {})", if glob { "subpath" } else { "literal" }, quoted(&p)))
}

pub fn profile(grants: &[Grant], approved: &[Need], program: &Path, tmp: &Path) -> String {
    let live = live(grants, approved);
    // only_protected picks the grants the deny below has to make way for: the ones the person approved for a
    // protected place itself. A broad grant never qualifies, however it was granted.
    let files = |access: &[&str], only_protected: bool| -> Vec<String> {
        live.iter()
            .filter(|a| a.need.kind == Kind::Files && access.contains(&a.need.access.as_str()))
            .filter(|a| !only_protected || (a.approved && scope_protects(&a.need.scope)))
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

// What programs print when the sandbox stops them: EPERM from a system call, or the sandbox's own wording when it
// stops dyld or a framework from opening a file (as xcrun does inside /usr/bin/git)
fn blocked(stderr: &str) -> bool {
    ["Operation not permitted", "sandbox blocked", "deny(1)", "Sandbox: "].iter().any(|s| stderr.contains(s))
}

// macOS counts processes per user, not per process group, so a ceiling has to start from what the person is
// already running: room enough for any real command, far short of what a fork bomb needs.
fn process_ceiling() -> Option<libc::rlim_t> {
    let bytes = unsafe { libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), std::ptr::null_mut(), 0) };
    if bytes <= 0 {
        return None;
    }
    Some(bytes as libc::rlim_t / size_of::<libc::pid_t>() as libc::rlim_t + PROC_HEADROOM)
}

fn kill_group(pgid: i32, signal: i32) {
    if pgid > 0 {
        unsafe {
            libc::killpg(pgid, signal);
        }
    }
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
    let ceiling = process_ceiling();
    unsafe {
        cmd.pre_exec(move || {
            let cpu = libc::rlimit { rlim_cur: CPU_SECONDS as libc::rlim_t, rlim_max: CPU_SECONDS as libc::rlim_t };
            let fsize = libc::rlimit { rlim_cur: FILE_BYTES, rlim_max: FILE_BYTES };
            let core = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
            libc::setrlimit(libc::RLIMIT_CPU, &cpu);
            libc::setrlimit(libc::RLIMIT_FSIZE, &fsize);
            libc::setrlimit(libc::RLIMIT_CORE, &core);
            if let Some(n) = ceiling {
                let procs = libc::rlimit { rlim_cur: n, rlim_max: n };
                libc::setrlimit(libc::RLIMIT_NPROC, &procs);
            }
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
    {
        use std::os::unix::process::ExitStatusExt;
        match status.signal() {
            Some(libc::SIGXFSZ) => return Ran::Failed("The command tried to write a file larger than 2 GB, Valet's limit, and was stopped.".into()),
            Some(libc::SIGXCPU) => return Ran::Failed("The command used 5 minutes of CPU time, Valet's limit, and was stopped.".into()),
            _ => {}
        }
    }
    let exit_code = status.code().unwrap_or(-1);
    let result = json!({
        "exit_code": exit_code,
        "stdout": String::from_utf8_lossy(&stdout),
        "stderr": stderr,
        "truncated": t1 || t2,
    });
    if exit_code == 71 && stderr.contains("execvp()") || exit_code != 0 && blocked(&stderr) {
        return Ran::Blocked(result);
    }
    Ran::Done(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Risk, Source};

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

    #[test]
    fn the_process_ceiling_leaves_room_for_a_real_command() {
        assert!(process_ceiling().is_some_and(|n| n > PROC_HEADROOM));
    }

    #[test]
    fn recognises_the_ways_a_sandbox_block_is_reported() {
        assert!(blocked("ls: /Users/x/.ssh: Operation not permitted"));
        assert!(blocked("xcrun: error: unable to load libxcrun (... (file system sandbox blocked open()), ...)"));
        assert!(!blocked("fatal: not a git repository"));
    }

    #[test]
    fn git_skips_its_global_config_unless_the_session_grants_it() {
        let git_global = |grants: &[Grant]| environment(grants, &tmp()).into_iter().any(|(k, _)| k == "GIT_CONFIG_GLOBAL");
        assert!(git_global(&[]));
        assert!(!git_global(&[grant(Kind::Files, "read", "~/**", Source::Proposed)]));
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

    #[test]
    fn only_an_approved_grant_for_the_place_itself_follows_the_deny() {
        let after_deny = |g: Grant| {
            let sb = profile(&[g], &[], Path::new("/bin/ls"), &tmp());
            sb.split_once("(deny file-read*").unwrap().1.to_string()
        };
        assert!(after_deny(grant(Kind::Files, "read", "~/.ssh/**", Source::Approved)).contains(".ssh"));
        assert!(!after_deny(grant(Kind::Files, "read", "~/**", Source::Approved)).contains("allow file-read*"));
    }

    #[tokio::test]
    async fn a_broad_grant_the_person_approved_leaves_protected_places_closed() {
        let all = [grant(Kind::Files, "read", "~/**", Source::Approved), grant(Kind::Programs, "run", "/bin/ls", Source::Approved)];
        assert!(matches!(sh("/bin/ls ~/Library/Logs", &all).await, Ran::Done(_)));
        assert!(matches!(sh("/bin/ls ~/.ssh", &all).await, Ran::Blocked(_)), "~/.ssh was readable");
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
