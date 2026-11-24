use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::json;
use tokio_util::sync::CancellationToken;

use super::{capture, environment, live, tags_dir, Job, Ran, CPU_SECONDS, WALL_LIMIT};
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

pub fn profile(grants: &[Grant], approved: &[Need], program: &Path, tmp: &Path, tag: Option<&Tag>) -> String {
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
    // last, so no grant can open it again
    if let Some(t) = tag {
        sb += &format!("(allow file-read* (subpath {}))\n", quoted(t.probe.parent().unwrap_or(&t.probe)));
        sb += &format!("(deny file-read* file-write* (literal {}))\n", quoted(&t.canary));
    }
    sb
}

// A program can leave its process group with setsid and outlive a killpg. Each confined run gets a tag no other
// sandbox has: it may read the probe and is denied its own canary, which sandbox_check can ask of any process
pub struct Tag {
    probe: PathBuf,
    canary: PathBuf,
}

extern "C" {
    fn sandbox_check(pid: libc::pid_t, operation: *const libc::c_char, filter: libc::c_int, ...) -> libc::c_int;
}

const FILTER_PATH: libc::c_int = 1;
const NO_REPORT: libc::c_int = 0x4000_0000;

fn denies(pid: libc::pid_t, path: &std::ffi::CStr) -> bool {
    unsafe { sandbox_check(pid, c"file-read-data".as_ptr(), FILTER_PATH | NO_REPORT, path.as_ptr()) == 1 }
}

fn cpath(p: &Path) -> Option<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(p.as_os_str().as_bytes()).ok()
}

impl Tag {
    pub fn new(tmp: &Path) -> std::io::Result<Self> {
        use std::os::unix::fs::DirBuilderExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = tags_dir(tmp);
        match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
            Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => return Err(e),
            _ => {}
        }
        let dir = crate::needs::real(&dir)?;
        // sandbox_check reports a path that doesn't exist as denied, so both files must be there
        let probe = dir.join("probe");
        if !probe.exists() {
            std::fs::write(&probe, b"")?;
        }
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let canary = dir.join(format!("run-{}-{n}", std::process::id()));
        std::fs::write(&canary, b"")?;
        Ok(Tag { probe, canary })
    }

    fn members(&self) -> Vec<libc::pid_t> {
        let (Some(probe), Some(canary)) = (cpath(&self.probe), cpath(&self.canary)) else { return vec![] };
        let me = std::process::id() as libc::pid_t;
        user_pids()
            .into_iter()
            .filter(|&p| p > 0 && p != me)
            .filter(|&p| unsafe { sandbox_check(p, std::ptr::null(), 0) } == 1 && denies(p, &canary) && !denies(p, &probe))
            .collect()
    }

    pub fn sweep(&self) {
        for _ in 0..5 {
            let found = self.members();
            if found.is_empty() {
                return;
            }
            for p in found {
                unsafe {
                    libc::kill(p, libc::SIGKILL);
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for Tag {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.canary);
    }
}

fn user_pids() -> Vec<libc::pid_t> {
    let bytes = unsafe { libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), std::ptr::null_mut(), 0) };
    if bytes <= 0 {
        return vec![];
    }
    let mut pids = vec![0 as libc::pid_t; bytes as usize / size_of::<libc::pid_t>() + 64];
    let bytes = unsafe { libc::proc_listpids(PROC_UID_ONLY, libc::getuid(), pids.as_mut_ptr().cast(), (pids.len() * size_of::<libc::pid_t>()) as i32) };
    pids.truncate(bytes.max(0) as usize / size_of::<libc::pid_t>());
    pids
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

// Everything a run started, by process group and, for a confined run, by its sandbox tag
pub struct Group {
    pgid: i32,
    tag: Option<Tag>,
}

impl Group {
    fn sweep(&self) {
        if let Some(t) = &self.tag {
            t.sweep();
        }
    }

    // once the program itself has exited: whatever it left behind goes too
    pub fn reap(&self) {
        kill_group(self.pgid, libc::SIGTERM);
        self.sweep();
    }

    pub async fn stop(&self) {
        kill_group(self.pgid, libc::SIGTERM);
        tokio::time::sleep(Duration::from_secs(2)).await;
        kill_group(self.pgid, libc::SIGKILL);
        self.sweep();
    }

    fn kill(&self) {
        kill_group(self.pgid, libc::SIGKILL);
        self.sweep();
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn(
    program: &Path,
    argv: &[String],
    cwd: Option<&Path>,
    grants: &[Grant],
    approved: &[Need],
    tmp: &Path,
    confined: bool,
    cpu_limit: bool,
) -> Result<(tokio::process::Child, Group), String> {
    let tag = if confined { Some(Tag::new(tmp).map_err(|e| format!("Couldn't prepare the sandbox: {e}"))?) } else { None };
    let mut cmd = if confined {
        let mut c = tokio::process::Command::new("/usr/bin/sandbox-exec");
        c.arg("-p").arg(profile(grants, approved, program, tmp, tag.as_ref())).arg(program);
        c
    } else {
        tokio::process::Command::new(program)
    };
    cmd.args(&argv[1..]);
    cmd.env_clear().envs(environment(grants, tmp));
    cmd.current_dir(cwd.unwrap_or(tmp));
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.process_group(0).kill_on_drop(true);
    let ceiling = process_ceiling();
    unsafe {
        cmd.pre_exec(move || {
            if cpu_limit {
                let cpu = libc::rlimit { rlim_cur: CPU_SECONDS as libc::rlim_t, rlim_max: CPU_SECONDS as libc::rlim_t };
                libc::setrlimit(libc::RLIMIT_CPU, &cpu);
            }
            let fsize = libc::rlimit { rlim_cur: FILE_BYTES, rlim_max: FILE_BYTES };
            let core = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
            libc::setrlimit(libc::RLIMIT_FSIZE, &fsize);
            libc::setrlimit(libc::RLIMIT_CORE, &core);
            if let Some(n) = ceiling {
                let procs = libc::rlimit { rlim_cur: n, rlim_max: n };
                libc::setrlimit(libc::RLIMIT_NPROC, &procs);
            }
            Ok(())
        });
    }
    let child = cmd.spawn().map_err(|e| format!("Couldn't start the program: {e}"))?;
    let pgid = child.id().map(|p| p as i32).unwrap_or(0);
    Ok((child, Group { pgid, tag }))
}

// A job is always confined: outside the sandbox nothing could find what it leaves behind
pub fn spawn_job(program: &Path, argv: &[String], cwd: Option<&Path>, grants: &[Grant], approved: &[Need], tmp: &Path) -> Result<Job, String> {
    let (mut child, group) = spawn(program, argv, cwd, grants, approved, tmp, true, false)?;
    let stdout = child.stdout.take().ok_or("The program has no output.")?;
    let stderr = child.stderr.take().ok_or("The program has no output.")?;
    Ok(Job { child, stdout, stderr, group })
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    program: &Path,
    argv: &[String],
    cwd: Option<&Path>,
    grants: &[Grant],
    approved: &[Need],
    tmp: &Path,
    confined: bool,
    stop: &CancellationToken,
) -> Ran {
    let (mut child, group) = match spawn(program, argv, cwd, grants, approved, tmp, confined, true) {
        Ok(s) => s,
        Err(e) => return Ran::Failed(e),
    };
    let out = tokio::spawn(capture(child.stdout.take().unwrap()));
    let err = tokio::spawn(capture(child.stderr.take().unwrap()));

    let status = tokio::select! {
        s = child.wait() => s.ok(),
        _ = tokio::time::sleep(WALL_LIMIT) => None,
        _ = stop.cancelled() => {
            group.stop().await;
            return Ran::Stopped;
        }
    };
    let Some(status) = status else {
        group.kill();
        return Ran::Failed("The command ran for 5 minutes and was stopped.".into());
    };
    group.reap();
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
    if confined && (exit_code == 71 && stderr.contains("execvp()") || exit_code != 0 && blocked(&stderr)) {
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
        run(Path::new("/bin/sh"), &argv, None, grants, &[], &tmp(), true, &CancellationToken::new()).await
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
        let r = run(Path::new("/usr/bin/uname"), &argv, None, &[], &[], &tmp(), true, &CancellationToken::new()).await;
        let Ran::Done(v) = r else { panic!("uname did not run") };
        assert_eq!(v["stdout"], "Darwin\n");
    }

    #[tokio::test]
    async fn a_setuid_program_runs_only_outside_the_sandbox() {
        let argv: Vec<String> = ["/usr/bin/top", "-l", "1", "-n", "0"].map(String::from).to_vec();
        let top = Path::new("/usr/bin/top");
        assert!(matches!(run(top, &argv, None, &[], &[], &tmp(), true, &CancellationToken::new()).await, Ran::Blocked(_)));
        let Ran::Done(v) = run(top, &argv, None, &[], &[], &tmp(), false, &CancellationToken::new()).await else { panic!("top did not run") };
        assert!(v["stdout"].as_str().unwrap().contains("Processes:"), "{v}");
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
            let sb = profile(&[g], &[], Path::new("/bin/ls"), &tmp(), None);
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
            run(Path::new("/usr/bin/curl"), &argv, None, &grants, &[], &tmp(), true, &CancellationToken::new()).await
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
        let r = run(Path::new("/bin/sh"), &argv, None, &[sleep], &[], &tmp(), true, &stop).await;
        assert!(matches!(r, Ran::Stopped));
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    fn running(pattern: &str) -> bool {
        std::process::Command::new("/usr/bin/pgrep").args(["-f", pattern]).output().is_ok_and(|o| o.status.success())
    }

    #[tokio::test]
    async fn a_program_that_leaves_its_process_group_is_still_stopped() {
        let perl = grant(Kind::Programs, "run", "/usr/bin/perl", Source::Proposed);
        let sleep = grant(Kind::Programs, "run", "/bin/sleep", Source::Proposed);
        let script = r#"use POSIX; if (fork() == 0) { POSIX::setsid(); if (fork() == 0) { exec("/bin/sleep", "61.7"); } exit 0; } sleep 1; exit 0;"#;
        let argv: Vec<String> = vec!["/usr/bin/perl".into(), "-e".into(), script.into()];
        let r = run(Path::new("/usr/bin/perl"), &argv, None, &[perl, sleep], &[], &tmp(), true, &CancellationToken::new()).await;
        assert!(matches!(r, Ran::Done(_)), "perl did not run");
        assert!(!running("sleep 61.7"), "the escaped process outlived its command");
    }

    #[tokio::test]
    async fn the_sweep_leaves_other_runs_alone() {
        let sleep = grant(Kind::Programs, "run", "/bin/sleep", Source::Proposed);
        let argv: Vec<String> = vec!["/bin/sleep".into(), "62.3".into()];
        let job = spawn_job(Path::new("/bin/sleep"), &argv, None, &[sleep.clone()], &[], &tmp()).unwrap();
        let r = run(Path::new("/bin/sleep"), &["/bin/sleep".into(), "0".into()], None, &[sleep], &[], &tmp(), true, &CancellationToken::new()).await;
        assert!(matches!(r, Ran::Done(_)));
        assert!(running("sleep 62.3"), "a sweep stopped another run");
        job.group.stop().await;
        assert!(!running("sleep 62.3"));
    }
}
