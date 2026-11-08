use std::path::{Component, Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::policy::max_risk;
use crate::types::{Kind, Need, Risk};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "tool", content = "args", rename_all = "snake_case")]
pub enum Request {
    RunCommand { command: Vec<String>, cwd: Option<String> },
    ReadFile { path: String, max_bytes: Option<u64> },
    WriteFile { path: String, content: String, base_hash: String },
    ListDir { path: String },
    TailLog { path: String, lines: Option<usize> },
    ListProcesses {},
}

impl Request {
    pub fn parse(tool: &str, args: &Value) -> Result<Self, String> {
        let empty = args.is_null() || args.as_array().is_some_and(|a| a.is_empty());
        let args = if empty { Value::Object(Default::default()) } else { args.clone() };
        serde_json::from_value(serde_json::json!({ "tool": tool, "args": args }))
            .map_err(|e| format!("The request for {tool} is malformed: {e}"))
    }
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub request: Request,
    pub literal: String,
    pub program: Option<PathBuf>,
    pub cwd: Option<PathBuf>,
    pub path: Option<PathBuf>,
    pub needs: Vec<Need>,
    pub risk: Risk,
}

#[cfg(unix)]
pub fn search_path() -> Vec<PathBuf> {
    ["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/opt/homebrew/bin"].iter().map(PathBuf::from).collect()
}

#[cfg(windows)]
pub fn search_path() -> Vec<PathBuf> {
    let root = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
    let files = PathBuf::from(std::env::var_os("ProgramFiles").unwrap_or_else(|| "C:\\Program Files".into()));
    let sys = root.join("System32");
    vec![
        sys.clone(),
        root.clone(),
        sys.join("Wbem"),
        sys.join("WindowsPowerShell\\v1.0"),
        sys.join("OpenSSH"),
        files.join("PowerShell\\7"),
        files.join("Git\\cmd"),
        files.join("nodejs"),
    ]
}

#[cfg(unix)]
const PROTECTED: &[(&str, &str)] = &[
    (".ssh", "SSH keys"),
    (".gnupg", "GPG keys"),
    (".aws", "AWS credentials"),
    (".azure", "Azure credentials"),
    (".config/gcloud", "Google Cloud credentials"),
    (".kube", "Kubernetes credentials"),
    (".docker/config.json", "Docker credentials"),
    (".netrc", "Saved logins"),
    (".npmrc", "npm token"),
    (".pypirc", "PyPI token"),
    (".config/gh", "GitHub CLI login"),
    (".git-credentials", "Git credentials"),
    ("Library/Keychains", "Keychains"),
    ("Library/Cookies", "Browser data"),
    ("Library/Safari", "Browser data"),
    ("Library/Application Support/Google/Chrome", "Browser data"),
    ("Library/Application Support/BraveSoftware", "Browser data"),
    ("Library/Application Support/Firefox", "Browser data"),
    ("Library/Application Support/Microsoft Edge", "Browser data"),
    ("Library/Application Support/Arc", "Browser data"),
    ("Library/Application Support/1Password", "Password manager"),
    ("Library/Group Containers/2BUA8C4S2C.com.1password", "Password manager"),
    ("Library/Application Support/Bitwarden", "Password manager"),
    ("Library/Messages", "Messages"),
    ("Library/Mail", "Mail"),
];
#[cfg(unix)]
fn protected_system() -> Vec<(PathBuf, &'static str)> {
    vec![(PathBuf::from("/Library/Keychains"), "Keychains"), (PathBuf::from("/private/etc/sudoers"), "Admin settings")]
}

#[cfg(windows)]
const PROTECTED: &[(&str, &str)] = &[
    (".ssh", "SSH keys"),
    (".gnupg", "GPG keys"),
    ("AppData/Roaming/gnupg", "GPG keys"),
    (".aws", "AWS credentials"),
    (".azure", "Azure credentials"),
    ("AppData/Roaming/gcloud", "Google Cloud credentials"),
    (".kube", "Kubernetes credentials"),
    (".docker/config.json", "Docker credentials"),
    ("_netrc", "Saved logins"),
    (".netrc", "Saved logins"),
    (".npmrc", "npm token"),
    (".pypirc", "PyPI token"),
    ("AppData/Roaming/GitHub CLI", "GitHub CLI login"),
    (".git-credentials", "Git credentials"),
    ("AppData/Roaming/Microsoft/Credentials", "Windows credentials"),
    ("AppData/Local/Microsoft/Credentials", "Windows credentials"),
    ("AppData/Local/Microsoft/Vault", "Windows credentials"),
    ("AppData/Roaming/Microsoft/Protect", "Windows encryption keys"),
    ("AppData/Roaming/Microsoft/Crypto", "Windows encryption keys"),
    ("AppData/Roaming/Microsoft/SystemCertificates", "Windows certificates"),
    ("AppData/Local/Packages", "App data"),
    ("AppData/Local/Google/Chrome", "Browser data"),
    ("AppData/Local/BraveSoftware", "Browser data"),
    ("AppData/Roaming/Mozilla/Firefox", "Browser data"),
    ("AppData/Local/Microsoft/Edge", "Browser data"),
    ("AppData/Local/Microsoft/Windows/INetCookies", "Browser data"),
    ("AppData/Roaming/Microsoft/Windows/Cookies", "Browser data"),
    ("AppData/Local/1Password", "Password manager"),
    ("AppData/Roaming/Bitwarden", "Password manager"),
    ("AppData/Roaming/KeePass", "Password manager"),
    ("AppData/Local/Microsoft/Outlook", "Mail"),
    ("AppData/Roaming/Thunderbird", "Mail"),
];

#[cfg(windows)]
fn protected_system() -> Vec<(PathBuf, &'static str)> {
    let root = PathBuf::from(std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()));
    vec![(root.join("System32\\config"), "Windows accounts")]
}

#[cfg(unix)]
const INTERPRETERS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "env", "xargs", "python", "python3", "perl", "ruby", "node",
    "osascript", "swift", "open",
];
#[cfg(unix)]
const ADMIN: &[&str] = &["sudo", "su", "doas", "login", "dscl", "security", "launchctl", "csrutil", "spctl"];
#[cfg(unix)]
const NETWORK: &[&str] = &[
    "curl", "wget", "nc", "ssh", "scp", "sftp", "rsync", "ping", "telnet", "ftp", "dig", "nslookup", "host", "traceroute",
];

// Windows names are compared lower-case and without .exe
#[cfg(windows)]
const INTERPRETERS: &[&str] = &[
    "cmd", "powershell", "pwsh", "wscript", "cscript", "mshta", "rundll32", "regsvr32", "msiexec", "python", "py", "pythonw",
    "perl", "ruby", "node", "bash", "sh", "wsl", "explorer", "forfiles", "conhost", "msbuild", "installutil",
];
#[cfg(windows)]
const ADMIN: &[&str] = &[
    "sudo", "runas", "reg", "regedit", "regini", "sc", "schtasks", "netsh", "bcdedit", "icacls", "cacls", "takeown", "net",
    "net1", "wmic", "diskpart", "secedit", "auditpol", "vssadmin", "wevtutil", "dism", "sfc", "shutdown", "bitlocker",
    "manage-bde", "cipher", "fsutil", "mountvol", "pnputil", "gpupdate",
];
#[cfg(windows)]
const NETWORK: &[&str] = &[
    "curl", "ping", "tracert", "pathping", "nslookup", "ssh", "scp", "sftp", "ftp", "tftp", "telnet", "bitsadmin", "certutil",
    "finger", "rsync", "wget",
];

const NETWORK_SUBCOMMANDS: &[(&str, &[&str])] = &[
    ("winget", &["install", "upgrade", "update", "download", "source", "search", "show"]),
    ("choco", &["install", "upgrade", "download", "search"]),
    ("scoop", &["install", "update", "bucket", "search"]),
    ("git", &["clone", "fetch", "pull", "push", "ls-remote", "submodule", "remote"]),
    ("brew", &["install", "upgrade", "update", "fetch", "reinstall", "tap"]),
    ("npm", &["install", "i", "ci", "update", "add", "publish"]),
    ("pnpm", &["install", "i", "add", "update", "publish"]),
    ("yarn", &["install", "add", "upgrade", "publish"]),
    ("pip", &["install", "download"]),
    ("pip3", &["install", "download"]),
    ("cargo", &["install", "fetch", "update", "publish"]),
    ("gem", &["install", "update"]),
];

#[cfg(unix)]
pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/var/empty"))
}

// The real profile folder, so it compares equal to canonical paths
#[cfg(windows)]
pub fn home() -> PathBuf {
    static HOME: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
    HOME.get_or_init(|| {
        let raw = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Users\\Default"));
        real(&raw).unwrap_or(raw)
    })
    .clone()
}

// canonicalize, without the \\?\ prefix Windows adds, which would never compare equal to anything a person typed
pub fn real(p: &Path) -> std::io::Result<PathBuf> {
    let r = std::fs::canonicalize(p)?;
    #[cfg(windows)]
    {
        let s = r.as_os_str().to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            if !rest.starts_with("UNC\\") {
                return Ok(PathBuf::from(rest.to_string()));
            }
        }
    }
    Ok(r)
}

// Whether p is root or inside it; Windows paths compare without regard to case
pub fn under(p: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let key = |c: Component| c.as_os_str().to_string_lossy().to_lowercase();
        let mut pc = p.components();
        root.components().all(|r| pc.next().is_some_and(|c| key(c) == key(r)))
    }
    #[cfg(unix)]
    {
        p.starts_with(root)
    }
}

// Scopes and displayed paths always use / so the same rules match them on every platform
pub fn slashed(p: &Path) -> String {
    let s = p.display().to_string();
    if cfg!(windows) {
        s.replace('\\', "/")
    } else {
        s
    }
}

pub fn tilde(p: &Path) -> String {
    let h = home();
    if under(p, &h) {
        let rest: PathBuf = p.components().skip(h.components().count()).collect();
        if rest.as_os_str().is_empty() {
            return "~".into();
        }
        return format!("~/{}", slashed(&rest));
    }
    slashed(p)
}

#[cfg(unix)]
fn is_absolute_text(raw: &str) -> bool {
    raw.starts_with('/')
}

// C:\ or C:/ only: drive-relative (C:x), rooted (\x), UNC and device paths are refused
#[cfg(windows)]
fn is_absolute_text(raw: &str) -> bool {
    let b = raw.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

#[cfg(unix)]
const ABSOLUTE_HINT: &str = "Start it with / or ~/.";
#[cfg(windows)]
const ABSOLUTE_HINT: &str = "Start it with a drive, like C:/, or with ~/.";

fn expand(raw: &str) -> Result<PathBuf, String> {
    let home_rest = raw.strip_prefix("~/").or_else(|| if cfg!(windows) { raw.strip_prefix("~\\") } else { None });
    let p = if raw == "~" {
        home()
    } else if let Some(rest) = home_rest {
        home().join(rest)
    } else if is_absolute_text(raw) {
        PathBuf::from(raw)
    } else {
        return Err(format!("{raw} is not an absolute path. {ABSOLUTE_HINT}"));
    };
    if p.components().any(|c| c == Component::ParentDir) {
        return Err(format!("{raw} contains \"..\". Send the path without it."));
    }
    #[cfg(windows)]
    {
        // A colon past the drive names an alternate data stream; trailing dots and spaces are silently dropped by Windows
        for c in p.components() {
            let Component::Normal(n) = c else { continue };
            let name = n.to_string_lossy();
            if name.contains(':') || name.ends_with('.') || name.ends_with(' ') {
                return Err(format!("{raw} has a name Windows would read differently ({name}). Send the plain path."));
            }
        }
    }
    Ok(p)
}

pub fn resolve(raw: &str) -> Result<PathBuf, String> {
    let p = expand(raw)?;
    if let Ok(real) = real(&p) {
        return Ok(real);
    }
    let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
        return Err(format!("{raw} isn't a usable path."));
    };
    let parent = real(parent).map_err(|_| format!("The folder for {raw} doesn't exist."))?;
    Ok(parent.join(name))
}

// A bare drive (C:) is its root folder
fn drive_root(base: &str) -> String {
    if cfg!(windows) && base.len() == 2 && base.ends_with(':') {
        format!("{base}/")
    } else {
        base.to_string()
    }
}

// The path a file scope names and whether it covers everything below, or None for a scope that isn't a path
pub fn scope_path(scope: &str) -> Option<(PathBuf, bool)> {
    let (base, glob) = match scope.strip_suffix("/**") {
        Some(b) => (b, true),
        None => (scope, false),
    };
    let base = drive_root(base);
    let p = if base == "~" {
        home()
    } else if let Some(rest) = base.strip_prefix("~/") {
        home().join(rest)
    } else if is_absolute_text(&base) {
        PathBuf::from(base)
    } else {
        return None;
    };
    Some((p, glob))
}

pub fn normalise_scope(scope: &str) -> String {
    let (base, glob) = match scope.strip_suffix("/**") {
        Some(b) => (b, true),
        None => (scope, false),
    };
    let base = drive_root(if base.is_empty() { "/" } else { base });
    if scope == "*" || !(base.starts_with('~') || is_absolute_text(&base)) {
        return scope.to_string();
    }
    match expand(&base).ok().and_then(|p| real(&p).ok()) {
        Some(real) => {
            let t = tilde(&real);
            if glob {
                format!("{}/**", t.trim_end_matches('/'))
            } else {
                t
            }
        }
        None => scope.to_string(),
    }
}

pub fn is_env_file(name: &str) -> bool {
    let name = if cfg!(windows) { name.to_ascii_lowercase() } else { name.to_string() };
    name == ".env" || name.starts_with(".env.")
}

pub fn protected_label(p: &Path) -> Option<&'static str> {
    if p.file_name().and_then(|n| n.to_str()).is_some_and(is_env_file) {
        return Some(".env file");
    }
    let h = home();
    PROTECTED
        .iter()
        .map(|(rel, label)| (h.join(rel), *label))
        .chain(protected_system())
        .find(|(root, _)| under(p, root))
        .map(|(_, label)| label)
}

#[cfg(unix)]
pub fn protected_roots() -> Vec<PathBuf> {
    let h = home();
    PROTECTED.iter().map(|(rel, _)| h.join(rel)).chain(protected_system().into_iter().map(|(p, _)| p)).collect()
}

fn scratch(p: &Path) -> bool {
    real(&std::env::temp_dir()).is_ok_and(|t| under(p, &t)) || cfg!(unix) && p.starts_with("/private/tmp")
}

fn file_need(p: &Path, access: &str, folder: bool) -> Need {
    let h = home();
    let label = protected_label(p);
    let inside = under(p, &h);
    let broad = under(&h, p);
    let risk = match (access, label) {
        (_, Some(_)) => Risk::High,
        ("write", _) if !inside && !scratch(p) => Risk::High,
        ("write", _) => Risk::Medium,
        _ if broad => Risk::Medium,
        _ => Risk::Low,
    };
    let scope = if folder { format!("{}/**", tilde(p).trim_end_matches('/')) } else { tilde(p) };
    Need { kind: Kind::Files, access: access.into(), scope, risk, protected_label: label.map(String::from) }
}

fn search_hint() -> String {
    search_path().iter().map(|p| slashed(p)).collect::<Vec<_>>().join(", ")
}

#[cfg(unix)]
pub fn find_program(name: &str) -> Result<PathBuf, String> {
    let found = if name.contains('/') {
        Some(expand(name)?)
    } else {
        search_path().iter().map(|d| d.join(name)).find(|p| is_executable(p))
    };
    let p = found.ok_or_else(|| format!("{name} isn't installed in {}.", search_hint()))?;
    let real = real(&p).map_err(|_| format!("{name} doesn't exist."))?;
    if !is_executable(&real) {
        return Err(format!("{name} isn't a program."));
    }
    Ok(real)
}

// Only .exe and .com start directly: CreateProcess quietly hands a .bat or .cmd to cmd.exe, which re-reads its arguments
#[cfg(windows)]
pub fn find_program(name: &str) -> Result<PathBuf, String> {
    let ext = |p: &Path| p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let script = |p: &Path| matches!(ext(p).as_deref(), Some("bat" | "cmd" | "ps1" | "vbs" | "js" | "wsf" | "hta"));
    let refuse = || format!("{name} is a script. Run it through its interpreter, such as cmd /c or powershell -File.");
    if script(Path::new(name)) {
        return Err(refuse());
    }
    let found = if name.contains('/') || name.contains('\\') {
        Some(expand(name)?)
    } else {
        let names: Vec<String> = if ext(Path::new(name)).is_some() {
            vec![name.to_string()]
        } else {
            vec![format!("{name}.exe"), format!("{name}.com")]
        };
        search_path().iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| is_executable(p))
    };
    let p = found.ok_or_else(|| format!("{name} isn't installed in {}.", search_hint()))?;
    let real = real(&p).map_err(|_| format!("{name} doesn't exist."))?;
    if script(&real) {
        return Err(refuse());
    }
    if !is_executable(&real) {
        return Err(format!("{name} isn't a program."));
    }
    Ok(real)
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(windows)]
fn is_executable(p: &Path) -> bool {
    let ext = p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    matches!(ext.as_deref(), Some("exe" | "com")) && std::fs::metadata(p).is_ok_and(|m| m.is_file())
}

// macOS refuses to exec setuid/setgid programs inside any sandbox, so asking the person would only end in a failure
#[cfg(unix)]
fn is_setuid(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.permissions().mode() & 0o6000 != 0)
}

#[cfg(windows)]
fn is_setuid(_: &Path) -> bool {
    false
}

fn program_base(program: &Path) -> String {
    let name = if cfg!(windows) { program.file_stem() } else { program.file_name() };
    let base = name.and_then(|n| n.to_str()).unwrap_or_default();
    let base = if cfg!(windows) { base.to_ascii_lowercase() } else { base.to_string() };
    base.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.').to_string()
}

fn program_needs(program: &Path, argv: &[String]) -> Vec<Need> {
    let base = program_base(program);
    let base = base.as_str();
    let scope = slashed(program);
    if ADMIN.contains(&base) {
        return vec![Need { kind: Kind::AdminRights, access: "elevate".into(), scope, risk: Risk::Critical, protected_label: None }];
    }
    let risk = if INTERPRETERS.contains(&base) { Risk::High } else { Risk::Medium };
    let mut needs = vec![Need { kind: Kind::Programs, access: "run".into(), scope, risk, protected_label: None }];
    let sub = argv.get(1).map(String::as_str).unwrap_or_default();
    let online = NETWORK.contains(&base)
        || NETWORK_SUBCOMMANDS.iter().any(|(p, subs)| *p == base && subs.contains(&sub));
    if online {
        needs.push(network_need());
    }
    needs
}

pub fn network_need() -> Need {
    Need { kind: Kind::Network, access: "connect".into(), scope: "*".into(), risk: Risk::High, protected_label: None }
}

fn quote(arg: &str) -> String {
    if !arg.is_empty() && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_./=:,@%+~".contains(c)) {
        arg.to_string()
    } else {
        format!("'{}'", arg.replace('\'', "'\\''"))
    }
}

pub fn literal(argv: &[String]) -> String {
    argv.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
}

pub fn plan(request: Request) -> Result<Plan, String> {
    let mut program = None;
    let mut cwd = None;
    let mut path = None;
    let (literal, needs) = match &request {
        Request::RunCommand { command, cwd: dir } => {
            let first = command.first().ok_or("The command is empty.")?;
            let prog = find_program(first)?;
            if is_setuid(&prog) {
                return Err(format!(
                    "{} runs with raised privileges (setuid), and macOS won't start those inside Valet's sandbox. Use a structured tool instead, such as list_processes for ps.",
                    prog.display()
                ));
            }
            let mut needs = program_needs(&prog, command);
            if let Some(dir) = dir {
                let d = resolve(dir)?;
                if !d.is_dir() {
                    return Err(format!("{dir} isn't a folder."));
                }
                needs.push(file_need(&d, "read", true));
                cwd = Some(d);
            }
            program = Some(prog);
            (literal(command), needs)
        }
        Request::ReadFile { path: raw, .. } | Request::TailLog { path: raw, .. } => {
            let p = resolve(raw)?;
            if !p.is_file() {
                return Err(format!("{raw} isn't a file."));
            }
            let need = file_need(&p, "read", false);
            path = Some(p);
            (need.scope.clone(), vec![need])
        }
        Request::WriteFile { path: raw, .. } => {
            let p = resolve(raw)?;
            if p.is_dir() {
                return Err(format!("{raw} is a folder."));
            }
            let need = file_need(&p, "write", false);
            path = Some(p);
            (need.scope.clone(), vec![need])
        }
        Request::ListDir { path: raw } => {
            let p = resolve(raw)?;
            if !p.is_dir() {
                return Err(format!("{raw} isn't a folder."));
            }
            let need = file_need(&p, "read", false);
            path = Some(p);
            (need.scope.clone(), vec![need])
        }
        Request::ListProcesses {} => (
            "list_processes".into(),
            vec![Need { kind: Kind::Processes, access: "list".into(), scope: "all".into(), risk: Risk::Low, protected_label: None }],
        ),
    };
    let risk = max_risk(&needs);
    Ok(Plan { request, literal, program, cwd, path, needs, risk })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_parent_paths() {
        assert!(resolve("notes.txt").is_err());
        assert!(resolve("~/Documents/../.ssh/id_rsa").is_err());
    }

    #[test]
    fn flags_protected_places() {
        let h = home();
        assert_eq!(protected_label(&h.join(".ssh/id_ed25519")), Some("SSH keys"));
        assert_eq!(protected_label(&h.join("code/app/.env.local")), Some(".env file"));
        assert_eq!(protected_label(&h.join(".sshx/notes")), None);
        assert_eq!(protected_label(&h.join("Library/Logs/x.log")), None);
    }

    #[test]
    fn writing_a_protected_file_is_high_risk() {
        let n = file_need(&home().join(".aws/credentials"), "write", false);
        assert_eq!(n.risk, Risk::High);
        assert_eq!(n.scope, "~/.aws/credentials");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn a_shell_is_high_risk_and_admin_tools_are_critical() {
        let p = plan(Request::RunCommand { command: vec!["sh".into(), "-c".into(), "ls".into()], cwd: None }).unwrap();
        assert_eq!(p.risk, Risk::High);
        let p = plan(Request::RunCommand { command: vec!["launchctl".into(), "list".into()], cwd: None }).unwrap();
        assert_eq!(p.risk, Risk::Critical);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn setuid_programs_are_turned_back_before_anyone_is_asked() {
        for prog in ["/bin/ps", "/usr/bin/sudo"] {
            let e = plan(Request::RunCommand { command: vec![prog.into()], cwd: None }).unwrap_err();
            assert!(e.contains("setuid"), "{e}");
        }
    }

    #[test]
    fn empty_args_parse_whether_object_array_or_null() {
        for args in [serde_json::json!({}), serde_json::json!([]), Value::Null] {
            assert!(matches!(Request::parse("list_processes", &args), Ok(Request::ListProcesses {})));
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn network_programs_need_the_network() {
        let p = plan(Request::RunCommand { command: vec!["/usr/bin/curl".into(), "https://example.com".into()], cwd: None }).unwrap();
        assert!(p.needs.iter().any(|n| n.kind == Kind::Network));
        let p = plan(Request::RunCommand { command: vec!["git".into(), "status".into()], cwd: None });
        if let Ok(p) = p {
            assert!(!p.needs.iter().any(|n| n.kind == Kind::Network));
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn a_working_folder_needs_reading_it() {
        let p = plan(Request::RunCommand { command: vec!["ls".into()], cwd: Some("/usr/share".into()) }).unwrap();
        assert!(p.needs.iter().any(|n| n.kind == Kind::Files && n.scope == "/usr/share/**"));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn scopes_normalise_to_the_real_path() {
        assert_eq!(normalise_scope("/tmp/**"), "/private/tmp/**");
        assert_eq!(normalise_scope("*"), "*");
        assert_eq!(normalise_scope("api.acme.com:443"), "api.acme.com:443");
    }

    #[test]
    fn quotes_arguments_for_display() {
        assert_eq!(literal(&["log".into(), "show".into(), "process == \"x\"".into()]), "log show 'process == \"x\"'");
    }

    #[cfg(windows)]
    mod windows {
        use super::*;

        fn system32() -> String {
            slashed(&real(&PathBuf::from(std::env::var("SystemRoot").unwrap()).join("System32")).unwrap())
        }

        #[test]
        fn refuses_paths_windows_reads_differently() {
            for raw in ["C:notes.txt", "\\Windows", "\\\\server\\share\\x", "\\\\?\\C:\\x", "~/notes.txt:secret", "~/notes.txt.", "~/x /y"] {
                assert!(resolve(raw).is_err(), "{raw} was accepted");
            }
            assert!(resolve("~\\..\\x").is_err());
        }

        #[test]
        fn scopes_use_forward_slashes_and_the_real_case() {
            let sys = system32();
            assert!(!sys.contains('\\'), "{sys}");
            assert_eq!(normalise_scope(&format!("{}/**", sys.to_uppercase())), format!("{sys}/**"));
            assert_eq!(normalise_scope("~"), "~");
            assert_eq!(normalise_scope("api.acme.com:443"), "api.acme.com:443");
            let (p, glob) = scope_path(&format!("{sys}/**")).unwrap();
            assert!(glob && p.is_dir());
        }

        #[test]
        fn protected_places_match_whatever_the_case() {
            let h = home();
            assert_eq!(protected_label(&h.join(".SSH").join("id_ed25519")), Some("SSH keys"));
            assert_eq!(protected_label(&h.join("AppData\\Roaming\\Microsoft\\Protect\\x")), Some("Windows encryption keys"));
            assert_eq!(protected_label(&h.join("code\\.ENV")), Some(".env file"));
            assert_eq!(protected_label(&h.join("AppData\\Local\\Temp\\x.log")), None);
        }

        #[test]
        fn finds_programs_by_name_and_refuses_scripts() {
            let p = plan(Request::RunCommand { command: vec!["whoami".into()], cwd: None }).unwrap();
            assert_eq!(p.needs[0].scope, format!("{}/whoami.exe", system32()));
            assert_eq!(p.risk, Risk::Medium);
            assert!(find_program("build.cmd").unwrap_err().contains("script"));
            assert!(find_program("C:/Windows/System32/notreal.exe").is_err());
        }

        #[test]
        fn shells_are_high_risk_and_admin_tools_are_critical() {
            let p = plan(Request::RunCommand { command: vec!["cmd".into(), "/c".into(), "dir".into()], cwd: None }).unwrap();
            assert_eq!(p.risk, Risk::High);
            let p = plan(Request::RunCommand { command: vec!["reg".into(), "query".into(), "HKCU".into()], cwd: None }).unwrap();
            assert_eq!(p.risk, Risk::Critical);
            let p = plan(Request::RunCommand { command: vec!["curl".into(), "https://example.com".into()], cwd: None }).unwrap();
            assert!(p.needs.iter().any(|n| n.kind == Kind::Network));
        }

        #[test]
        fn writing_outside_home_and_temp_is_high_risk() {
            let n = file_need(Path::new("C:\\Windows\\System32\\drivers\\etc\\hosts"), "write", false);
            assert_eq!(n.risk, Risk::High);
            let t = real(&std::env::temp_dir()).unwrap().join("x.txt");
            assert_eq!(file_need(&t, "write", false).risk, Risk::Medium);
            assert_eq!(file_need(&home(), "read", true).risk, Risk::Medium);
        }
    }
}
