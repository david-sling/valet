// Windows has no path-based sandbox like sandbox-exec, so each command gets its own AppContainer:
//
// - The container's SID is new for every command and never reused. It starts with no access to anything in the person's
//   profile, the same as an app from the Store; it can read system folders, which grant "ALL APPLICATION PACKAGES".
// - Each file grant becomes an access-control entry for that SID, added just before the command starts and removed when
//   it ends. A folder grant writes an entry on every file and folder inside it, one at a time, skipping protected places
//   and .env files unless the person approved them. Nothing is pushed down by inheritance, so whatever was skipped never
//   gets an entry: the container's access check doesn't honour deny entries, so closing a place means never opening it.
// - Network access is the internetClient and privateNetworkClientServer capabilities, added only for an approved grant.
// - The command runs in a Job Object: it can't start other programs unless the session grants more than one program,
//   it gets 5 minutes of CPU, no clipboard or other windows, and stopping the session kills everything in the job.
//
// If Valet dies mid-command, the entries it added stay behind but name a SID nothing runs as any more, so they grant nothing.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{FromRawHandle, RawHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::json;
use tokio_util::sync::CancellationToken;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, LocalFree, SetHandleInformation, ERROR_ACCESS_DENIED, ERROR_SUCCESS, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
    HLOCAL, WAIT_OBJECT_0, WIN32_ERROR,
};
use windows::Win32::Security::Authorization::{
    ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, REVOKE_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
    TRUSTEE_W,
};
use windows::Win32::Security::Isolation::{CreateAppContainerProfile, DeleteAppContainerProfile, DeriveAppContainerSidFromAppContainerName};
use windows::Win32::Security::{
    FreeSid, GetSecurityDescriptorControl, InitializeSecurityDescriptor, SetFileSecurityW, SetSecurityDescriptorControl,
    SetSecurityDescriptorDacl, ACE_FLAGS, ACL, DACL_SECURITY_INFORMATION, NO_INHERITANCE, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES, SECURITY_DESCRIPTOR, SECURITY_DESCRIPTOR_CONTROL, SE_DACL_AUTO_INHERITED,
    SE_DACL_PROTECTED, SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE, DELETE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_BASIC_UI_RESTRICTIONS, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_JOB_TIME, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOB_OBJECT_UILIMIT,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, InitializeProcThreadAttributeList, ResumeThread,
    UpdateProcThreadAttribute, WaitForSingleObject, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
    DETACHED_PROCESS, EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

use super::{capture, environment, live, Ran, CPU_SECONDS, WALL_LIMIT};
use crate::needs::{protected_label, real, scope_path, tilde, under};
use crate::types::{Grant, Kind, Need};

// Opening a folder means writing an entry on everything inside it, so a folder this big is turned back instead
const WALK_LIMIT: usize = 20_000;

const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;
const PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES: usize = 0x0002_0009;
const PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY: usize = 0x0002_000E;
const PROCESS_CREATION_CHILD_PROCESS_RESTRICTED: u32 = 0x01;
const SE_GROUP_ENABLED: u32 = 0x4;
const SECURITY_DESCRIPTOR_REVISION: u32 = 1;
const INTERNET_CLIENT: &str = "S-1-15-3-1";
const PRIVATE_NETWORK: &str = "S-1-15-3-3";

// SetNamedSecurityInfo reads, changes and writes a whole list; two commands editing the same folder at once would lose one edit
static ACL_LOCK: Mutex<()> = Mutex::new(());
static RUNS: AtomicU64 = AtomicU64::new(0);

struct Owned(HANDLE);

unsafe impl Send for Owned {}
unsafe impl Sync for Owned {}

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_invalid() && !self.0 .0.is_null() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

impl Owned {
    fn take(mut self) -> HANDLE {
        std::mem::take(&mut self.0)
    }
}

fn wide(s: impl AsRef<OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Access {
    Read,
    Write,
    Full,
}

impl Access {
    fn mask(self) -> u32 {
        match self {
            Access::Read => FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0,
            Access::Write => FILE_GENERIC_READ.0 | FILE_GENERIC_EXECUTE.0 | FILE_GENERIC_WRITE.0 | DELETE.0,
            Access::Full => FILE_ALL_ACCESS.0,
        }
    }
}

#[derive(Debug, PartialEq)]
struct Entry {
    path: PathBuf,
    access: Access,
    // A folder entry also applies to files the command creates in it
    inherit: bool,
    // Push the entry down to everything already inside (only the command's own scratch folder)
    propagate: bool,
}

#[derive(Debug, Default)]
struct Rules {
    entries: Vec<Entry>,
    // Folders the command could write new files into: their inherited entries are cleared from the top afterwards
    written: Vec<PathBuf>,
    children: bool,
    network: bool,
}

fn covers(scope: &(PathBuf, bool), p: &Path) -> bool {
    if scope.1 {
        under(p, &scope.0)
    } else {
        p.components().count() == scope.0.components().count() && under(p, &scope.0)
    }
}

struct Opener<'a> {
    approved: &'a [(PathBuf, bool)],
    budget: usize,
    entries: Vec<Entry>,
}

impl Opener<'_> {
    // Protected places and .env files stay closed unless the person approved them by name or by an approved folder
    fn closed(&self, p: &Path) -> bool {
        protected_label(p).is_some() && !self.approved.iter().any(|a| covers(a, p))
    }

    fn spend(&mut self, top: &Path) -> Result<(), String> {
        if self.budget == 0 {
            return Err(format!(
                "{} holds more than {WALK_LIMIT} files and folders, too many to open to a sandboxed command on Windows. Grant a smaller folder.",
                tilde(top)
            ));
        }
        self.budget -= 1;
        Ok(())
    }

    // An entry on every folder and file below dir, each written on its own, so nothing reaches what was skipped.
    // Links and junctions are left alone: writing an entry on one would change whatever it points to.
    fn open_tree(&mut self, top: &Path, dir: &Path, access: Access) -> Result<(), String> {
        self.entries.push(Entry { path: dir.to_path_buf(), access, inherit: true, propagate: false });
        let Ok(items) = std::fs::read_dir(dir) else { return Ok(()) };
        for item in items.flatten() {
            self.spend(top)?;
            let path = item.path();
            let Ok(kind) = item.file_type() else { continue };
            if kind.is_symlink() || self.closed(&path) {
                continue;
            }
            if kind.is_dir() {
                self.open_tree(top, &path, access)?;
            } else {
                self.entries.push(Entry { path, access, inherit: false, propagate: false });
            }
        }
        Ok(())
    }
}

fn rules(grants: &[Grant], approved: &[Need], program: &Path, tmp: &Path) -> Result<Rules, String> {
    let live = live(grants, approved);
    let mut r = Rules::default();

    for a in live.iter().filter(|a| a.need.kind == Kind::Programs && a.need.access == "run") {
        let other = scope_path(&a.need.scope).is_none_or(|(p, _)| !(under(&p, program) && under(program, &p)));
        r.children |= a.need.scope == "*" || other;
    }
    r.network = live.iter().any(|a| a.need.kind == Kind::Network && a.approved);

    let mut files: Vec<(PathBuf, bool, Access)> = Vec::new();
    let mut opened: Vec<(PathBuf, bool)> = Vec::new();
    for a in live.iter().filter(|a| a.need.kind == Kind::Files && ["read", "write"].contains(&a.need.access.as_str())) {
        if a.need.scope == "*" {
            return Err("This session grants every file, which Windows can't apply to a sandboxed command. Grant the folders it needs instead.".into());
        }
        let Some((path, glob)) = scope_path(&a.need.scope) else { continue };
        let Ok(path) = real(&path) else { continue };
        let access = if a.need.access == "write" { Access::Write } else { Access::Read };
        if a.approved {
            opened.push((path.clone(), glob));
        }
        files.push((path, glob, access));
    }

    let mut opener = Opener { approved: &opened, budget: WALK_LIMIT, entries: Vec::new() };
    opener.entries.push(Entry { path: tmp.to_path_buf(), access: Access::Full, inherit: true, propagate: true });
    for (path, glob, access) in &files {
        if opener.closed(path) {
            continue;
        }
        if *glob && path.is_dir() {
            opener.open_tree(path, path, *access)?;
            if *access == Access::Write {
                r.written.push(path.clone());
            }
        } else {
            opener.entries.push(Entry { path: path.clone(), access: *access, inherit: false, propagate: false });
        }
    }
    r.entries = opener.entries;
    Ok(r)
}

struct Sid(PSID, bool);

unsafe impl Send for Sid {}

impl Drop for Sid {
    fn drop(&mut self) {
        unsafe {
            if self.1 {
                FreeSid(self.0);
            } else {
                let _ = LocalFree(Some(HLOCAL(self.0 .0)));
            }
        }
    }
}

fn string_sid(s: &str) -> Result<Sid, String> {
    let mut sid = PSID::default();
    unsafe { ConvertStringSidToSidW(PCWSTR(wide(s).as_ptr()), &mut sid) }.map_err(|e| e.to_string())?;
    Ok(Sid(sid, false))
}

// Adds (or with revoke, removes) the container's entry on one path. Without propagate the list is written to that path
// alone, so entries already inside a folder are left exactly as they were.
fn edit_acl(path: &Path, sid: PSID, access: Access, inherit: bool, revoke: bool, propagate: bool) -> Result<(), WIN32_ERROR> {
    let name = wide(path);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut sd = PSECURITY_DESCRIPTOR::default();
    let err = unsafe {
        GetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None, None, Some(&mut dacl), None, &mut sd)
    };
    if err != ERROR_SUCCESS {
        return Err(err);
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: access.mask(),
        grfAccessMode: if revoke { REVOKE_ACCESS } else { GRANT_ACCESS },
        grfInheritance: if inherit { SUB_CONTAINERS_AND_OBJECTS_INHERIT } else { ACE_FLAGS(NO_INHERITANCE.0) },
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: PWSTR(sid.0 as *mut u16),
        },
    };
    let mut updated: *mut ACL = std::ptr::null_mut();
    let err = unsafe { SetEntriesInAclW(Some(&[entry]), Some(dacl), &mut updated) };
    let result = if err != ERROR_SUCCESS {
        Err(err)
    } else if propagate {
        let err = unsafe { SetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None, None, Some(updated), None) };
        if err == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(err)
        }
    } else {
        unsafe { write_dacl(&name, sd, updated) }
    };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(updated as _)));
        let _ = LocalFree(Some(HLOCAL(sd.0)));
    }
    result
}

// SetFileSecurity writes one object's list and, unlike SetNamedSecurityInfo, doesn't push inheritable entries into a folder's contents
unsafe fn write_dacl(name: &[u16], old: PSECURITY_DESCRIPTOR, dacl: *mut ACL) -> Result<(), WIN32_ERROR> {
    let fail = |e: windows::core::Error| WIN32_ERROR::from_error(&e).unwrap_or(ERROR_ACCESS_DENIED);
    let (mut control, mut revision) = (0u16, 0u32);
    unsafe { GetSecurityDescriptorControl(old, &mut control, &mut revision) }.map_err(fail)?;
    let mut sd = SECURITY_DESCRIPTOR::default();
    let psd = PSECURITY_DESCRIPTOR(&mut sd as *mut _ as _);
    unsafe {
        InitializeSecurityDescriptor(psd, SECURITY_DESCRIPTOR_REVISION).map_err(fail)?;
        SetSecurityDescriptorDacl(psd, true, Some(dacl), false).map_err(fail)?;
        let kept = SECURITY_DESCRIPTOR_CONTROL(SE_DACL_AUTO_INHERITED.0 | SE_DACL_PROTECTED.0);
        SetSecurityDescriptorControl(psd, kept, SECURITY_DESCRIPTOR_CONTROL(control & kept.0)).map_err(fail)?;
        if SetFileSecurityW(PCWSTR(name.as_ptr()), DACL_SECURITY_INFORMATION, psd).as_bool() {
            Ok(())
        } else {
            Err(WIN32_ERROR::from_error(&windows::core::Error::from_thread()).unwrap_or(ERROR_ACCESS_DENIED))
        }
    }
}

// Best effort: whatever is left over names a SID nothing runs as any more
fn clear_tree(dir: &Path, sid: PSID, budget: &mut usize) {
    let Ok(items) = std::fs::read_dir(dir) else { return };
    for item in items.flatten() {
        if *budget == 0 {
            return;
        }
        *budget -= 1;
        let Ok(kind) = item.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let _ = edit_acl(&item.path(), sid, Access::Full, kind.is_dir(), true, false);
        if kind.is_dir() {
            clear_tree(&item.path(), sid, budget);
        }
    }
}

// One command's container: its SID and every entry it added, removed again on drop
struct Container {
    name: Vec<u16>,
    sid: Sid,
    touched: Vec<(PathBuf, bool, bool)>,
    written: Vec<PathBuf>,
}

impl Container {
    fn create() -> Result<Self, String> {
        let n = RUNS.fetch_add(1, Ordering::Relaxed);
        let name = format!("valet.run.{}.{}.{n}", std::process::id(), crate::types::now_ms());
        let w = wide(&name);
        let display = wide("Valet command");
        let sid = match unsafe { CreateAppContainerProfile(PCWSTR(w.as_ptr()), PCWSTR(display.as_ptr()), PCWSTR(display.as_ptr()), None) } {
            Ok(sid) => sid,
            Err(_) => unsafe { DeriveAppContainerSidFromAppContainerName(PCWSTR(w.as_ptr())) }
                .map_err(|e| format!("Couldn't create a sandbox for the command: {e}"))?,
        };
        Ok(Container { name: w, sid: Sid(sid, true), touched: Vec::new(), written: Vec::new() })
    }

    fn apply(&mut self, rules: &Rules) -> Result<(), String> {
        let _held = ACL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.written = rules.written.clone();
        for e in &rules.entries {
            self.touched.push((e.path.clone(), e.inherit, e.propagate));
            match edit_acl(&e.path, self.sid.0, e.access, e.inherit, false, e.propagate) {
                Ok(()) => {}
                // A system folder the person can't change is usually readable by every container already;
                // if it isn't, the command is blocked there and says so
                Err(err) if err == ERROR_ACCESS_DENIED => {}
                Err(err) => {
                    let why = windows::core::Error::from(err.to_hresult()).message();
                    return Err(format!("Couldn't open {} for the command: {why}", tilde(&e.path)));
                }
            }
        }
        Ok(())
    }
}

impl Drop for Container {
    fn drop(&mut self) {
        let _held = ACL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut seen: Vec<&PathBuf> = Vec::new();
        for (path, inherit, propagate) in self.touched.iter().rev() {
            if seen.contains(&path) {
                continue;
            }
            seen.push(path);
            let _ = edit_acl(path, self.sid.0, Access::Full, *inherit, true, *propagate);
        }
        // Files the command made inside a granted folder took a copy of its entry, marked inherited or not depending on
        // the folder; each one is cleared, then the folder is recomputed from the top for the inherited kind
        let mut budget = WALK_LIMIT * 5;
        for path in &self.written {
            clear_tree(path, self.sid.0, &mut budget);
            let _ = edit_acl(path, self.sid.0, Access::Full, true, true, true);
        }
        unsafe {
            let _ = DeleteAppContainerProfile(PCWSTR(self.name.as_ptr()));
        }
    }
}

// The quoting the Microsoft C runtime undoes, so each argument arrives exactly as sent
fn quote(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\x0b', '"']) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut slashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', slashes * 2));
    out.push('"');
}

fn command_line(program: &Path, argv: &[String]) -> String {
    let mut line = String::new();
    quote(&program.display().to_string(), &mut line);
    // cmd reads everything after /c itself and knows nothing of \" escapes, so that part goes through as written
    let cmd = program.file_stem().is_some_and(|s| s.eq_ignore_ascii_case("cmd"));
    let script = if cmd { argv.iter().skip(1).position(|a| ["/c", "/k", "/r"].iter().any(|f| a.eq_ignore_ascii_case(f))) } else { None };
    for (i, a) in argv.iter().skip(1).enumerate() {
        line.push(' ');
        if script.is_some_and(|s| i > s) {
            line.push_str(a);
        } else {
            quote(a, &mut line);
        }
    }
    line
}

fn env_block(env: &[(String, String)]) -> Vec<u16> {
    let mut env = env.to_vec();
    env.sort_by_key(|(k, _)| k.to_ascii_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (k, v) in env {
        block.extend(OsStr::new(&format!("{k}={v}")).encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

fn pipe(child_reads: bool) -> Result<(Owned, Owned), String> {
    let sa = SECURITY_ATTRIBUTES { nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32, lpSecurityDescriptor: std::ptr::null_mut(), bInheritHandle: true.into() };
    let (mut r, mut w) = (HANDLE::default(), HANDLE::default());
    unsafe { CreatePipe(&mut r, &mut w, Some(&sa), 0) }.map_err(|e| e.to_string())?;
    let (r, w) = (Owned(r), Owned(w));
    let ours = if child_reads { &w } else { &r };
    unsafe { SetHandleInformation(ours.0, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) }.map_err(|e| e.to_string())?;
    Ok((r, w))
}

struct Started {
    process: Owned,
    job: Owned,
    stdout: Owned,
    stderr: Owned,
}

fn job(cpu_seconds: u64) -> Result<Owned, String> {
    let job = Owned(unsafe { CreateJobObjectW(None, PCWSTR::null()) }.map_err(|e| e.to_string())?);
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION | JOB_OBJECT_LIMIT_JOB_TIME;
    limits.BasicLimitInformation.PerJobUserTimeLimit = (cpu_seconds * 10_000_000) as i64;
    let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS { UIRestrictionsClass: JOB_OBJECT_UILIMIT(0xFF) };
    unsafe {
        SetInformationJobObject(job.0, JobObjectExtendedLimitInformation, &limits as *const _ as _, std::mem::size_of_val(&limits) as u32)
            .map_err(|e| e.to_string())?;
        SetInformationJobObject(job.0, JobObjectBasicUIRestrictions, &ui as *const _ as _, std::mem::size_of_val(&ui) as u32).map_err(|e| e.to_string())?;
    }
    Ok(job)
}

fn start(container: &Container, rules: &Rules, program: &Path, argv: &[String], cwd: &Path, env: &[(String, String)]) -> Result<Started, String> {
    if argv.iter().any(|a| a.contains('\0')) {
        return Err("An argument contains a NUL character, which Windows can't pass to a program.".into());
    }
    let caps: Vec<Sid> = if rules.network { vec![string_sid(INTERNET_CLIENT)?, string_sid(PRIVATE_NETWORK)?] } else { vec![] };
    let mut cap_attrs: Vec<SID_AND_ATTRIBUTES> = caps.iter().map(|s| SID_AND_ATTRIBUTES { Sid: s.0, Attributes: SE_GROUP_ENABLED }).collect();
    let security = SECURITY_CAPABILITIES {
        AppContainerSid: container.sid.0,
        Capabilities: if cap_attrs.is_empty() { std::ptr::null_mut() } else { cap_attrs.as_mut_ptr() },
        CapabilityCount: cap_attrs.len() as u32,
        Reserved: 0,
    };

    let (stdin_r, stdin_w) = pipe(true)?;
    drop(stdin_w);
    let (stdout_r, stdout_w) = pipe(false)?;
    let (stderr_r, stderr_w) = pipe(false)?;
    let inherited = [stdin_r.0, stdout_w.0, stderr_w.0];

    let attrs = if rules.children { 2 } else { 3 };
    let mut size = 0usize;
    unsafe {
        let _ = InitializeProcThreadAttributeList(None, attrs, None, &mut size);
    }
    let mut buf = vec![0u8; size];
    let list = LPPROC_THREAD_ATTRIBUTE_LIST(buf.as_mut_ptr() as _);
    unsafe { InitializeProcThreadAttributeList(Some(list), attrs, None, &mut size) }.map_err(|e| e.to_string())?;
    struct List(LPPROC_THREAD_ATTRIBUTE_LIST);
    impl Drop for List {
        fn drop(&mut self) {
            unsafe { DeleteProcThreadAttributeList(self.0) }
        }
    }
    let _list = List(list);
    let policy = PROCESS_CREATION_CHILD_PROCESS_RESTRICTED;
    unsafe {
        UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, Some(&security as *const _ as _), std::mem::size_of_val(&security), None, None)
            .map_err(|e| e.to_string())?;
        UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, Some(inherited.as_ptr() as _), std::mem::size_of_val(&inherited), None, None)
            .map_err(|e| e.to_string())?;
        if !rules.children {
            UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_CHILD_PROCESS_POLICY, Some(&policy as *const _ as _), std::mem::size_of_val(&policy), None, None)
                .map_err(|e| e.to_string())?;
        }
    }

    let mut si = STARTUPINFOEXW::default();
    si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = stdin_r.0;
    si.StartupInfo.hStdOutput = stdout_w.0;
    si.StartupInfo.hStdError = stderr_w.0;
    si.lpAttributeList = list;

    let app = wide(program);
    let mut line = wide(command_line(program, argv));
    let env = env_block(env);
    let dir = wide(cwd);
    let job = job(CPU_SECONDS)?;
    let mut pi = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(
            PCWSTR(app.as_ptr()),
            Some(PWSTR(line.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT | DETACHED_PROCESS,
            Some(env.as_ptr() as _),
            PCWSTR(dir.as_ptr()),
            &si.StartupInfo,
            &mut pi,
        )
    }
    .map_err(|e| format!("Couldn't start the program: {}", e.message()))?;
    let process = Owned(pi.hProcess);
    let thread = Owned(pi.hThread);
    if let Err(e) = unsafe { AssignProcessToJobObject(job.0, process.0) } {
        unsafe {
            let _ = windows::Win32::System::Threading::TerminateProcess(process.0, 1);
        }
        return Err(format!("Couldn't contain the program: {}", e.message()));
    }
    unsafe { ResumeThread(thread.0) };
    Ok(Started { process, job, stdout: stdout_r, stderr: stderr_r })
}

fn reader(h: Owned) -> tokio::fs::File {
    tokio::fs::File::from_std(unsafe { std::fs::File::from_raw_handle(h.take().0 as RawHandle) })
}

fn kill(job: &Owned) {
    unsafe {
        let _ = TerminateJobObject(job.0, 1);
    }
}

const DENIED: &[&str] = &["access is denied", "access denied", "unauthorizedaccess", "permissiondenied", "permission denied", "operation not permitted"];

pub async fn run(
    program: &Path,
    argv: &[String],
    cwd: Option<&Path>,
    grants: &[Grant],
    approved: &[Need],
    tmp: &Path,
    stop: &CancellationToken,
) -> Ran {
    let rules = match rules(grants, approved, program, tmp) {
        Ok(r) => r,
        Err(e) => return Ran::Failed(e),
    };
    let prepared = tokio::task::spawn_blocking(move || {
        let mut c = Container::create()?;
        c.apply(&rules)?;
        Ok::<_, String>((c, rules))
    })
    .await;
    let (container, rules) = match prepared {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => return Ran::Failed(e),
        Err(e) => return Ran::Failed(e.to_string()),
    };
    let env = environment(grants, tmp);
    let started = start(&container, &rules, program, argv, cwd.unwrap_or(tmp), &env);
    let Started { process, job, stdout, stderr } = match started {
        Ok(s) => s,
        Err(e) => {
            let _ = tokio::task::spawn_blocking(move || drop(container)).await;
            return Ran::Failed(e);
        }
    };
    let out = tokio::spawn(capture(reader(stdout)));
    let err = tokio::spawn(capture(reader(stderr)));
    let process = std::sync::Arc::new(process);
    let waiting = process.clone();
    let wait = tokio::task::spawn_blocking(move || {
        let mut code = 0u32;
        let done = unsafe { WaitForSingleObject(waiting.0, INFINITE) } == WAIT_OBJECT_0;
        (done && unsafe { GetExitCodeProcess(waiting.0, &mut code) }.is_ok()).then_some(code)
    });

    let status = tokio::select! {
        s = wait => s.ok().flatten(),
        _ = tokio::time::sleep(WALL_LIMIT) => None,
        _ = stop.cancelled() => {
            kill(&job);
            let _ = tokio::task::spawn_blocking(move || drop(container)).await;
            return Ran::Stopped;
        }
    };
    kill(&job);
    let (stdout, t1) = out.await.unwrap_or_default();
    let (stderr, t2) = err.await.unwrap_or_default();
    let _ = tokio::task::spawn_blocking(move || drop(container)).await;
    let Some(code) = status else {
        return Ran::Failed("The command ran for 5 minutes and was stopped.".into());
    };
    let stderr = String::from_utf8_lossy(&stderr).into_owned();
    let stdout = String::from_utf8_lossy(&stdout).into_owned();
    let exit_code = code as i32;
    let result = json!({ "exit_code": exit_code, "stdout": stdout, "stderr": stderr, "truncated": t1 || t2 });
    let said = format!("{stderr}\n{stdout}").to_lowercase();
    if exit_code != 0 && DENIED.iter().any(|d| said.contains(d)) {
        return Ran::Blocked(result);
    }
    Ran::Done(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
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

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("valet-sb-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        real(&d).unwrap()
    }

    fn system(name: &str) -> PathBuf {
        PathBuf::from(std::env::var("SystemRoot").unwrap()).join("System32").join(name)
    }

    fn scope(p: &Path, glob: bool) -> String {
        let s = crate::needs::tilde(p);
        if glob {
            format!("{s}/**")
        } else {
            s
        }
    }

    async fn cmd(script: &str, grants: &[Grant], tmp: &Path) -> Ran {
        let cmd = system("cmd.exe");
        let argv = vec!["cmd".into(), "/d".into(), "/c".into(), script.into()];
        run(&cmd, &argv, None, grants, &[], tmp, &CancellationToken::new()).await
    }

    fn output(r: &Ran) -> String {
        match r {
            Ran::Done(v) | Ran::Blocked(v) => format!("{} {}", v["stdout"], v["stderr"]),
            Ran::Failed(e) => e.clone(),
            Ran::Stopped => "stopped".into(),
        }
    }

    fn ace_count(p: &Path) -> u16 {
        let name = wide(p);
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut sd = PSECURITY_DESCRIPTOR::default();
        unsafe {
            let err = GetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None, None, Some(&mut dacl), None, &mut sd);
            assert_eq!(err, ERROR_SUCCESS);
            let n = (*dacl).AceCount;
            let _ = LocalFree(Some(HLOCAL(sd.0)));
            n
        }
    }

    fn aces(p: &Path) -> Vec<(u8, u8, u32)> {
        let name = wide(p);
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut sd = PSECURITY_DESCRIPTOR::default();
        let mut found = Vec::new();
        unsafe {
            GetNamedSecurityInfoW(PCWSTR(name.as_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, None, None, Some(&mut dacl), None, &mut sd);
            for i in 0..(*dacl).AceCount {
                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
                windows::Win32::Security::GetAce(dacl, i as u32, &mut ace).unwrap();
                let h = &*(ace as *const windows::Win32::Security::ACE_HEADER);
                found.push((h.AceType, h.AceFlags, *((ace as *const u8).add(4) as *const u32)));
            }
            let _ = LocalFree(Some(HLOCAL(sd.0)));
        }
        found
    }

    #[test]
    fn quotes_arguments_the_way_programs_read_them() {
        let line = command_line(Path::new("C:\\Windows\\System32\\cmd.exe"), &["cmd".into(), "a b".into(), "say \"hi\"".into(), "C:\\dir\\".into(), "".into()]);
        assert_eq!(line, r#"C:\Windows\System32\cmd.exe "a b" "say \"hi\"" C:\dir\ """#);
        let mut q = String::new();
        quote("C:\\my dir\\", &mut q);
        assert_eq!(q, r#""C:\my dir\\""#);
        let line = command_line(Path::new("C:\\Windows\\System32\\cmd.exe"), &["cmd".into(), "/d".into(), "/c".into(), "type \"C:\\a b.txt\"".into()]);
        assert_eq!(line, r#"C:\Windows\System32\cmd.exe /d /c type "C:\a b.txt""#);
    }

    #[tokio::test]
    async fn runs_a_granted_program() {
        let tmp = dir("run");
        let whoami = system("whoami.exe");
        let argv = vec!["whoami".into()];
        let r = run(&whoami, &argv, None, &[], &[], &tmp, &CancellationToken::new()).await;
        let Ran::Done(v) = &r else { panic!("whoami did not run: {}", output(&r)) };
        assert_eq!(v["exit_code"], 0, "{v}");
        assert!(!v["stdout"].as_str().unwrap().trim().is_empty());
    }

    #[tokio::test]
    async fn files_and_programs_not_granted_stay_closed() {
        let tmp = dir("closed");
        let elsewhere = dir("elsewhere");
        std::fs::write(elsewhere.join("note.txt"), "private").unwrap();
        let r = cmd(&format!("type \"{}\"", elsewhere.join("note.txt").display()), &[], &tmp).await;
        assert!(matches!(r, Ran::Blocked(_)), "an ungranted file was readable: {}", output(&r));
        let r = cmd("whoami", &[], &tmp).await;
        assert!(!matches!(r, Ran::Done(ref v) if v["exit_code"] == 0), "a second program started: {}", output(&r));
        let r = cmd("echo inside> made.txt && type made.txt", &[], &tmp).await;
        assert!(output(&r).contains("inside"), "the command's own folder wasn't writable: {}", output(&r));
    }

    #[tokio::test]
    async fn a_folder_grant_opens_the_folder_but_not_its_env_files_and_leaves_no_trace() {
        let tmp = dir("grant");
        let project = dir("project");
        std::fs::create_dir_all(project.join("src")).unwrap();
        std::fs::write(project.join("src").join("main.txt"), "hello").unwrap();
        std::fs::write(project.join(".env"), "SECRET=1").unwrap();
        let before = (ace_count(&project), ace_count(&project.join("src").join("main.txt")), ace_count(&project.join(".env")));
        let read = [grant(Kind::Files, "read", &scope(&project, true), Source::Proposed)];

        let r = cmd(&format!("type \"{}\"", project.join("src").join("main.txt").display()), &read, &tmp).await;
        assert!(output(&r).contains("hello"), "a granted file wasn't readable: {}", output(&r));
        let r = cmd(&format!("type \"{}\"", project.join(".env").display()), &read, &tmp).await;
        assert!(matches!(r, Ran::Blocked(_)), ".env was readable under a folder grant: {}", output(&r));
        let r = cmd(&format!("echo x> \"{}\"", project.join("new.txt").display()), &read, &tmp).await;
        assert!(!project.join("new.txt").exists(), "a read grant allowed writing: {}", output(&r));

        let after = (ace_count(&project), ace_count(&project.join("src").join("main.txt")), ace_count(&project.join(".env")));
        assert_eq!(before, after, "access entries were left behind");

        let approved = [grant(Kind::Files, "read", &scope(&project.join(".env"), false), Source::Approved)];
        let both: Vec<Grant> = read.iter().chain(approved.iter()).cloned().collect();
        let r = cmd(&format!("type \"{}\"", project.join(".env").display()), &both, &tmp).await;
        assert!(output(&r).contains("SECRET"), "an approved .env stayed closed: {}", output(&r));
    }

    #[tokio::test]
    async fn a_write_grant_lets_the_command_write_and_leaves_no_trace_on_what_it_made() {
        let tmp = dir("write");
        let out = dir("out");
        std::fs::write(out.join("mine.txt"), "made by the person").unwrap();
        let write = [grant(Kind::Files, "write", &scope(&out, true), Source::Proposed)];
        let r = cmd(&format!("echo made> \"{}\"", out.join("new.txt").display()), &write, &tmp).await;
        assert!(out.join("new.txt").exists(), "a write grant didn't allow writing: {}", output(&r));
        let shown = format!("{:?} vs {:?}", aces(&out.join("new.txt")), aces(&out.join("mine.txt")));
        assert_eq!(ace_count(&out.join("new.txt")), ace_count(&out.join("mine.txt")), "the new file kept the container's entry: {shown}");
        assert_eq!(ace_count(&out), ace_count(&out.join("mine.txt")));
    }

    #[tokio::test]
    async fn a_second_program_grant_lets_the_shell_start_it() {
        let tmp = dir("children");
        let whoami = [grant(Kind::Programs, "run", &crate::needs::slashed(&system("whoami.exe")), Source::Proposed)];
        let r = cmd("whoami", &whoami, &tmp).await;
        assert!(matches!(r, Ran::Done(ref v) if v["exit_code"] == 0), "{}", output(&r));
    }

    #[tokio::test]
    async fn the_network_needs_an_approved_grant() {
        let tmp = dir("net");
        let curl = system("curl.exe");
        if !curl.exists() {
            return;
        }
        let argv: Vec<String> = ["curl", "-sS", "-m", "5", "-o", "NUL", "https://example.com"].map(String::from).to_vec();
        let proposed = [grant(Kind::Network, "connect", "*", Source::Proposed)];
        let r = run(&curl, &argv, None, &proposed, &[], &tmp, &CancellationToken::new()).await;
        assert!(!matches!(r, Ran::Done(ref v) if v["exit_code"] == 0), "reached the network without approval");
    }

    #[tokio::test]
    async fn a_folder_too_big_to_open_is_turned_back() {
        let tmp = dir("big");
        let sys = [grant(Kind::Files, "read", &scope(&system(""), true), Source::Proposed)];
        let r = cmd("ver", &sys, &tmp).await;
        assert!(matches!(&r, Ran::Failed(e) if e.contains("too many")), "{}", output(&r));
        let every = [grant(Kind::Files, "read", "*", Source::Proposed)];
        assert!(matches!(cmd("ver", &every, &tmp).await, Ran::Failed(_)));
    }

    #[tokio::test]
    async fn stopping_kills_the_job() {
        let tmp = dir("stop");
        let stop = CancellationToken::new();
        let s = stop.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            s.cancel();
        });
        let cmd = system("cmd.exe");
        let argv = vec!["cmd".into(), "/d".into(), "/c".into(), "for /l %i in (1,0,2) do @rem".into()];
        let started = std::time::Instant::now();
        let r = run(&cmd, &argv, None, &[], &[], &tmp, &stop).await;
        assert!(matches!(r, Ran::Stopped));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}

