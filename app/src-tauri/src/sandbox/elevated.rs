// Running one command as administrator on Windows, after the person approved it with Windows Hello.
//
// A process Valet starts itself can't be elevated, and Valet (running as the person, unelevated) can't put an elevated
// process into a Job Object of its own: Windows refuses that across integrity levels, and ShellExecuteEx can't start a
// program suspended, so the command would already be running before it was contained. So Valet asks Windows, through
// UAC, to start a second copy of itself as a helper (`valet.exe --run-elevated`). The helper, already elevated:
//
// - checks that both pipes it was pointed at are served by a running copy of this same Valet program;
// - checks that Windows really gave it an administrator token (UAC can be switched off, and then nothing elevates);
// - reads the one command it is to run, creates a Job Object of its own (5 minutes of CPU, no clipboard or other
//   windows, everything killed when the job closes), starts the command suspended, puts it in the job, then resumes it;
// - streams the command's output back, and kills the whole job the moment Valet closes its pipe (Stop, the time limit,
//   or Valet quitting) or the helper itself ends.
//
// Valet in turn checks that the process on the other end of each pipe is the helper Windows just started. The helper
// runs one command and exits; it is never a service that takes further commands.
//
// What the job can't do: a process running as administrator can start work Windows runs outside the job, such as a
// service, a scheduled task or a WMI process. The job contains what the command starts directly, not everything an
// administrator can cause. That is why this is critical risk and confirmed every time.

use std::io::{Read, Write};
use std::os::windows::io::{AsRawHandle, RawHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use tokio_util::sync::CancellationToken;
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_CANCELLED, HANDLE, HWND, WAIT_OBJECT_0};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::JobObjects::TerminateJobObject;
use windows::Win32::System::Pipes::{GetNamedPipeClientProcessId, GetNamedPipeServerProcessId};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, GetProcessId, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, WaitForSingleObject,
    INFINITE, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

use super::windows::{kill, start_outside, wide, Owned, Started};
use super::{environment, Ran, OUTPUT_CAP, WALL_LIMIT};
use crate::types::{now_ms, Grant};

pub const HELPER_FLAG: &str = "--run-elevated";

const STDOUT: u8 = 1;
const STDERR: u8 = 2;
const DONE: u8 = 3;
// The request is a program, its arguments, a folder and the environment; nothing near this
const REQUEST_LIMIT: u32 = 4 * 1024 * 1024;
// The person has already answered UAC by the time the helper starts, so it connects at once or not at all
const CONNECT_WAIT: Duration = Duration::from_secs(30);

static RUNS: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize)]
struct Request {
    program: PathBuf,
    argv: Vec<String>,
    cwd: PathBuf,
    env: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize)]
struct Finished {
    exit_code: Option<u32>,
    error: Option<String>,
}

fn frame(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut f = Vec::with_capacity(5 + bytes.len());
    f.push(tag);
    f.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    f.extend_from_slice(bytes);
    f
}

fn handle(raw: RawHandle) -> HANDLE {
    HANDLE(raw as _)
}

fn image_of(pid: u32) -> Result<PathBuf, String> {
    let process = Owned(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.map_err(|e| e.message())?);
    let mut buf = vec![0u16; 32_768];
    let mut len = buf.len() as u32;
    unsafe { QueryFullProcessImageNameW(process.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len) }.map_err(|e| e.message())?;
    Ok(PathBuf::from(String::from_utf16_lossy(&buf[..len as usize])))
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a.as_os_str().eq_ignore_ascii_case(b.as_os_str()),
        _ => false,
    }
}

// ---- Valet's side ----

enum Launch {
    Declined,
    Failed(String),
}

// Shows UAC on the secure desktop and waits for the person's answer; the helper runs hidden, as the command does
fn launch(parameters: String) -> Result<usize, Launch> {
    let exe = std::env::current_exe().map_err(|e| Launch::Failed(format!("Couldn't find Valet's own program: {e}")))?;
    let file = wide(&exe);
    let params = wide(&parameters);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        hwnd: HWND(crate::approve::window() as _),
        lpVerb: w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    match unsafe { ShellExecuteExW(&mut info) } {
        Ok(()) if !info.hProcess.is_invalid() && !info.hProcess.0.is_null() => Ok(info.hProcess.0 as usize),
        Ok(()) => Err(Launch::Failed("Windows started Valet's administrator helper without a way to follow it, so the command didn't run.".into())),
        Err(e) if e.code() == ERROR_CANCELLED.to_hresult() => Err(Launch::Declined),
        Err(e) => Err(Launch::Failed(format!("Windows couldn't ask for administrator rights: {}", e.message()))),
    }
}

fn client_is(pipe: &NamedPipeServer, pid: u32) -> bool {
    let mut client = 0u32;
    unsafe { GetNamedPipeClientProcessId(handle(pipe.as_raw_handle()), &mut client) }.is_ok() && client == pid && pid != 0
}

struct Output {
    kept: Vec<u8>,
    truncated: bool,
}

impl Output {
    fn new() -> Self {
        Output { kept: Vec::new(), truncated: false }
    }
    fn push(&mut self, bytes: &[u8]) {
        let room = OUTPUT_CAP.saturating_sub(self.kept.len());
        self.kept.extend_from_slice(&bytes[..bytes.len().min(room)]);
        self.truncated |= bytes.len() > room;
    }
}

async fn read_frames(out: &mut NamedPipeServer) -> Result<(Output, Output, Finished), String> {
    let lost = "Valet lost touch with its administrator helper before the command finished.";
    let (mut stdout, mut stderr) = (Output::new(), Output::new());
    loop {
        let mut head = [0u8; 5];
        out.read_exact(&mut head).await.map_err(|_| lost.to_string())?;
        let len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]);
        if len > REQUEST_LIMIT {
            return Err(lost.into());
        }
        let mut body = vec![0u8; len as usize];
        out.read_exact(&mut body).await.map_err(|_| lost.to_string())?;
        match head[0] {
            STDOUT => stdout.push(&body),
            STDERR => stderr.push(&body),
            DONE => {
                let done: Finished = serde_json::from_slice(&body).map_err(|_| lost.to_string())?;
                return Ok((stdout, stderr, done));
            }
            _ => return Err(lost.into()),
        }
    }
}

pub async fn run_elevated(program: &Path, argv: &[String], cwd: Option<&Path>, grants: &[Grant], tmp: &Path, stop: &CancellationToken) -> Ran {
    if argv.iter().any(|a| a.contains('\0')) {
        return Ran::Failed("An argument contains a NUL character, which Windows can't pass to a program.".into());
    }
    let n = RUNS.fetch_add(1, Ordering::Relaxed);
    let name = format!(r"\\.\pipe\valet-elevated-{}-{}-{n}", std::process::id(), now_ms());
    let pipe = |suffix: &str| ServerOptions::new().first_pipe_instance(true).max_instances(1).reject_remote_clients(true).create(format!("{name}-{suffix}"));
    let (mut ctl, mut out) = match (pipe("ctl"), pipe("out")) {
        (Ok(c), Ok(o)) => (c, o),
        (Err(e), _) | (_, Err(e)) => return Ran::Failed(format!("Couldn't prepare to run the command as administrator: {e}")),
    };

    let parameters = format!("{HELPER_FLAG} {name} {}", std::process::id());
    let launched = tokio::task::spawn_blocking(move || launch(parameters)).await;
    let helper = match launched {
        Ok(Ok(h)) => Owned(HANDLE(h as _)),
        Ok(Err(Launch::Declined)) => {
            return Ran::Declined("The person said no at the Windows administrator prompt (UAC), so the command didn't run.".into())
        }
        Ok(Err(Launch::Failed(e))) => return Ran::Failed(e),
        Err(e) => return Ran::Failed(e.to_string()),
    };
    // Stopped while UAC was showing: dropping the pipes leaves the helper nothing to connect to, so it runs nothing
    if stop.is_cancelled() {
        return Ran::Stopped;
    }
    let pid = unsafe { GetProcessId(helper.0) };
    let connected = tokio::select! {
        r = async { ctl.connect().await?; out.connect().await } => r.is_ok(),
        _ = tokio::time::sleep(CONNECT_WAIT) => false,
        _ = stop.cancelled() => return Ran::Stopped,
    };
    if !connected {
        return Ran::Failed("Windows started Valet's administrator helper, but it didn't connect, so the command didn't run.".into());
    }
    if !client_is(&ctl, pid) || !client_is(&out, pid) {
        return Ran::Failed("Something other than Valet's administrator helper answered, so the command didn't run.".into());
    }

    let request = Request { program: program.to_path_buf(), argv: argv.to_vec(), cwd: cwd.unwrap_or(tmp).to_path_buf(), env: environment(grants, tmp) };
    let body = match serde_json::to_vec(&request) {
        Ok(b) => b,
        Err(e) => return Ran::Failed(e.to_string()),
    };
    let mut head = (body.len() as u32).to_le_bytes().to_vec();
    head.extend_from_slice(&body);
    if ctl.write_all(&head).await.is_err() {
        return Ran::Failed("Valet lost touch with its administrator helper before the command started.".into());
    }

    // Closing ctl (by returning) is what tells the helper to kill the job
    let read = tokio::select! {
        r = read_frames(&mut out) => r,
        _ = tokio::time::sleep(WALL_LIMIT) => return Ran::Failed("The command ran for 5 minutes and was stopped.".into()),
        _ = stop.cancelled() => return Ran::Stopped,
    };
    drop(ctl);
    let (stdout, stderr, done) = match read {
        Ok(r) => r,
        Err(e) => return Ran::Failed(e),
    };
    if let Some(e) = done.error {
        return Ran::Failed(e);
    }
    let Some(code) = done.exit_code else {
        return Ran::Failed("The command ran for 5 minutes and was stopped.".into());
    };
    let truncated = stdout.truncated || stderr.truncated;
    let stdout = String::from_utf8_lossy(&stdout.kept).into_owned();
    let stderr = String::from_utf8_lossy(&stderr.kept).into_owned();
    Ran::Done(json!({ "exit_code": code as i32, "stdout": stdout, "stderr": stderr, "truncated": truncated }))
}

// ---- The helper's side, in the elevated copy ----

fn served_by_valet(pipe: &std::fs::File, expected: u32) -> Result<(), String> {
    let mut server = 0u32;
    unsafe { GetNamedPipeServerProcessId(handle(pipe.as_raw_handle()), &mut server) }.map_err(|e| e.message())?;
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    if server != expected || !same_file(&image_of(server)?, &me) {
        return Err("The pipe isn't served by Valet.".into());
    }
    Ok(())
}

fn elevated() -> bool {
    let mut token = HANDLE::default();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }.is_err() {
        return false;
    }
    let token = Owned(token);
    let mut e = TOKEN_ELEVATION::default();
    let mut len = 0u32;
    let ok = unsafe { GetTokenInformation(token.0, TokenElevation, Some(&mut e as *mut _ as _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len) };
    ok.is_ok() && e.TokenIsElevated != 0
}

fn forward(from: Owned, tag: u8, to: Arc<Mutex<std::fs::File>>) -> std::thread::JoinHandle<()> {
    let raw = from.take().0 as usize;
    std::thread::spawn(move || {
        let mut f = unsafe { <std::fs::File as std::os::windows::io::FromRawHandle>::from_raw_handle(raw as RawHandle) };
        let mut chunk = [0u8; 16 * 1024];
        let mut sent = 0usize;
        while let Ok(n) = f.read(&mut chunk) {
            if n == 0 {
                break;
            }
            // Past what Valet keeps, one byte more says it was cut; the rest is read and dropped so the command never stalls
            let room = (OUTPUT_CAP + 1).saturating_sub(sent);
            if room > 0 {
                let part = &chunk[..n.min(room)];
                sent += part.len();
                let mut w = to.lock().unwrap_or_else(|e| e.into_inner());
                if w.write_all(&frame(tag, part)).is_err() {
                    break;
                }
            }
        }
    })
}

fn serve(ctl: &mut std::fs::File, out: &Arc<Mutex<std::fs::File>>) -> Result<Option<u32>, String> {
    if !elevated() {
        return Err("Windows didn't give the command administrator rights, so it didn't run. User Account Control may be switched off on this PC.".into());
    }
    let mut len = [0u8; 4];
    ctl.read_exact(&mut len).map_err(|e| e.to_string())?;
    let len = u32::from_le_bytes(len);
    if len > REQUEST_LIMIT {
        return Err("The request was too large.".into());
    }
    let mut body = vec![0u8; len as usize];
    ctl.read_exact(&mut body).map_err(|e| e.to_string())?;
    let req: Request = serde_json::from_slice(&body).map_err(|e| e.to_string())?;

    let Started { process, job, stdout, stderr, pty } = start_outside(&req.program, &req.argv, &req.cwd, &req.env)?;
    let readers = [forward(stdout, STDOUT, out.clone()), forward(stderr, STDERR, out.clone())];
    // Valet closing its end, for whatever reason, kills everything in the job at once
    let job_raw = job.0 .0 as usize;
    let mut watch = ctl.try_clone().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut b = [0u8; 1];
        let _ = watch.read(&mut b);
        unsafe {
            let _ = TerminateJobObject(HANDLE(job_raw as _), 1);
        }
        std::process::exit(1);
    });
    let mut code = 0u32;
    let finished = unsafe { WaitForSingleObject(process.0, INFINITE) } == WAIT_OBJECT_0 && unsafe { GetExitCodeProcess(process.0, &mut code) }.is_ok();
    kill(&job);
    for r in readers {
        let _ = r.join();
    }
    drop(pty);
    Ok(finished.then_some(code))
}

// The entry point of the elevated copy: `valet.exe --run-elevated <pipe> <valet's process id>`
pub fn helper_main(args: &[String]) -> i32 {
    let [_, flag, name, pid] = args else { return 2 };
    if flag != HELPER_FLAG || !name.starts_with(r"\\.\pipe\valet-elevated-") {
        return 2;
    }
    let Ok(pid) = pid.parse::<u32>() else { return 2 };
    let open = |suffix: &str| std::fs::OpenOptions::new().read(true).write(true).open(format!("{name}-{suffix}"));
    let (Ok(mut ctl), Ok(out)) = (open("ctl"), open("out")) else { return 1 };
    if served_by_valet(&ctl, pid).is_err() || served_by_valet(&out, pid).is_err() {
        return 1;
    }
    let out = Arc::new(Mutex::new(out));
    let result = serve(&mut ctl, &out);
    let done = match result {
        Ok(exit_code) => Finished { exit_code, error: None },
        Err(e) => Finished { exit_code: None, error: Some(e) },
    };
    let body = serde_json::to_vec(&done).unwrap_or_default();
    let mut w = out.lock().unwrap_or_else(|e| e.into_inner());
    let _ = w.write_all(&frame(DONE, &body));
    let _ = w.flush();
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_carry_their_tag_and_length() {
        let f = frame(STDERR, b"hi");
        assert_eq!(f, vec![STDERR, 2, 0, 0, 0, b'h', b'i']);
    }

    #[test]
    fn output_past_the_cap_is_marked_truncated() {
        let mut o = Output::new();
        o.push(&vec![b'a'; OUTPUT_CAP]);
        assert!(!o.truncated);
        o.push(b"b");
        assert!(o.truncated);
        assert_eq!(o.kept.len(), OUTPUT_CAP);
    }

    #[test]
    fn the_helper_runs_only_when_started_as_the_helper() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(helper_main(&a(&["valet.exe"])), 2);
        assert_eq!(helper_main(&a(&["valet.exe", HELPER_FLAG, r"\\.\pipe\something-else", "1"])), 2);
        assert_eq!(helper_main(&a(&["valet.exe", HELPER_FLAG, r"\\.\pipe\valet-elevated-x", "not-a-pid"])), 2);
        assert_eq!(helper_main(&a(&["valet.exe", HELPER_FLAG, r"\\.\pipe\valet-elevated-none", "1"])), 1, "no pipe, nothing runs");
    }

    // A pipe served by some other program is refused before the helper reads anything from it
    #[tokio::test]
    async fn the_helper_refuses_a_pipe_valet_does_not_serve() {
        let name = format!(r"\\.\pipe\valet-elevated-test-{}-{}", std::process::id(), now_ms());
        let _ctl = ServerOptions::new().first_pipe_instance(true).create(format!("{name}-ctl")).unwrap();
        let _out = ServerOptions::new().first_pipe_instance(true).create(format!("{name}-out")).unwrap();
        let f = std::fs::OpenOptions::new().read(true).write(true).open(format!("{name}-ctl")).unwrap();
        // served by this test process: refused when told to expect another process, taken when the process and program match
        assert!(served_by_valet(&f, std::process::id() + 1).is_err());
        served_by_valet(&f, std::process::id()).unwrap();
    }
}
