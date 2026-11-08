use std::path::{Component, Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::policy::max_risk;
use crate::types::{Kind, Need, Risk};

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "tool", content = "args", rename_all = "snake_case")]
pub enum Request {
    // network: the agent says the command reaches the network, so the person is asked for it even when the program
    // (a shell, say) doesn't show it
    RunCommand {
        command: Vec<String>,
        cwd: Option<String>,
        #[serde(default)]
        network: bool,
    },
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

pub const SEARCH_PATH: &[&str] = &["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/local/bin", "/opt/homebrew/bin"];

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
const PROTECTED_SYSTEM: &[(&str, &str)] = &[("/Library/Keychains", "Keychains"), ("/private/etc/sudoers", "Admin settings")];

const INTERPRETERS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "ksh", "csh", "tcsh", "fish", "env", "xargs", "python", "python3", "perl", "ruby", "node",
    "osascript", "swift", "open",
];
const ADMIN: &[&str] = &["sudo", "su", "doas", "login", "dscl", "security", "launchctl", "csrutil", "spctl"];
const NETWORK: &[&str] = &[
    "curl", "wget", "nc", "ssh", "scp", "sftp", "rsync", "ping", "telnet", "ftp", "dig", "nslookup", "host", "traceroute",
];
const NETWORK_SUBCOMMANDS: &[(&str, &[&str])] = &[
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

pub fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/var/empty"))
}

pub fn tilde(p: &Path) -> String {
    let h = home();
    match p.strip_prefix(&h) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".into(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => p.display().to_string(),
    }
}

fn expand(raw: &str) -> Result<PathBuf, String> {
    let p = if raw == "~" {
        home()
    } else if let Some(rest) = raw.strip_prefix("~/") {
        home().join(rest)
    } else if raw.starts_with('/') {
        PathBuf::from(raw)
    } else {
        return Err(format!("{raw} is not an absolute path. Start it with / or ~/."));
    };
    if p.components().any(|c| c == Component::ParentDir) {
        return Err(format!("{raw} contains \"..\". Send the path without it."));
    }
    Ok(p)
}

pub fn resolve(raw: &str) -> Result<PathBuf, String> {
    let p = expand(raw)?;
    if let Ok(real) = std::fs::canonicalize(&p) {
        return Ok(real);
    }
    let (Some(parent), Some(name)) = (p.parent(), p.file_name()) else {
        return Err(format!("{raw} isn't a usable path."));
    };
    let parent = std::fs::canonicalize(parent).map_err(|_| format!("The folder for {raw} doesn't exist."))?;
    Ok(parent.join(name))
}

pub fn normalise_scope(scope: &str) -> String {
    if scope == "*" || !(scope.starts_with('/') || scope.starts_with('~')) {
        return scope.to_string();
    }
    let (base, glob) = match scope.strip_suffix("/**") {
        Some(b) => (b, true),
        None => (scope, false),
    };
    let base = if base.is_empty() { "/" } else { base };
    match expand(base).ok().and_then(|p| std::fs::canonicalize(p).ok()) {
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

pub fn protected_label(p: &Path) -> Option<&'static str> {
    if p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n == ".env" || n.starts_with(".env.")) {
        return Some(".env file");
    }
    let h = home();
    PROTECTED
        .iter()
        .map(|(rel, label)| (h.join(rel), *label))
        .chain(PROTECTED_SYSTEM.iter().map(|(abs, label)| (PathBuf::from(abs), *label)))
        .find(|(root, _)| p.starts_with(root))
        .map(|(_, label)| label)
}

// The real place a grant scope points at; "*" and anything relative name none.
pub fn scope_path(scope: &str) -> Option<PathBuf> {
    expand(scope.strip_suffix("/**").unwrap_or(scope)).ok()
}

// Whether the scope names a protected place itself, rather than merely holding one.
pub fn scope_protects(scope: &str) -> bool {
    scope_path(scope).is_some_and(|p| protected_label(&p).is_some())
}

// "This folder" widens a file to its folder, which must not reach over a protected place: one click on a
// file in the home folder would otherwise carry the SSH keys and keychains with it.
pub fn can_widen(scope: &str) -> bool {
    let Some((parent, _)) = scope.rsplit_once('/') else { return false };
    let Some(folder) = scope_path(if parent.is_empty() { "/" } else { parent }) else { return false };
    !protected_roots().iter().any(|r| r.starts_with(&folder))
}

pub fn protected_roots() -> Vec<PathBuf> {
    let h = home();
    PROTECTED
        .iter()
        .map(|(rel, _)| h.join(rel))
        .chain(PROTECTED_SYSTEM.iter().map(|(abs, _)| PathBuf::from(abs)))
        .collect()
}

fn file_need(p: &Path, access: &str, folder: bool) -> Need {
    let h = home();
    let label = protected_label(p);
    let broad = p == h || !p.starts_with(&h) && h.starts_with(p);
    let scratch = std::fs::canonicalize(std::env::temp_dir()).is_ok_and(|t| p.starts_with(t)) || p.starts_with("/private/tmp");
    let risk = match (access, label) {
        (_, Some(_)) => Risk::High,
        ("write", _) if !p.starts_with(&h) && !scratch => Risk::High,
        ("write", _) => Risk::Medium,
        _ if broad => Risk::Medium,
        _ => Risk::Low,
    };
    let scope = if folder { format!("{}/**", tilde(p).trim_end_matches('/')) } else { tilde(p) };
    Need { kind: Kind::Files, access: access.into(), scope, risk, protected_label: label.map(String::from) }
}

pub fn find_program(name: &str) -> Result<PathBuf, String> {
    let found = if name.contains('/') {
        Some(expand(name)?)
    } else {
        SEARCH_PATH.iter().map(|d| Path::new(d).join(name)).find(|p| is_executable(p))
    };
    let p = found.ok_or_else(|| format!("{name} isn't installed in {}.", SEARCH_PATH.join(", ")))?;
    let real = std::fs::canonicalize(&p).map_err(|_| format!("{name} doesn't exist."))?;
    if !is_executable(&real) {
        return Err(format!("{name} isn't a program."));
    }
    Ok(real)
}

fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

// macOS refuses to exec setuid/setgid programs inside any sandbox, so asking the person would only end in a failure
fn is_setuid(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(p).is_ok_and(|m| m.permissions().mode() & 0o6000 != 0)
}

fn program_needs(program: &Path, argv: &[String]) -> Vec<Need> {
    let base = program.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let base = base.trim_end_matches(|c: char| c.is_ascii_digit() || c == '.');
    let scope = program.display().to_string();
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

// A permission the agent proposes is rated here from its scope; the agent's own label can only raise it.
pub fn rate(mut n: Need) -> Need {
    let local = match n.kind {
        Kind::Files if n.access != "read" && n.access != "write" => Risk::High,
        Kind::Files => {
            let folder = n.scope.ends_with("/**");
            let base = n.scope.strip_suffix("/**").map(|b| if b.is_empty() { "/" } else { b }).unwrap_or(&n.scope);
            match resolve(base) {
                Ok(p) => {
                    let f = file_need(&p, &n.access, folder);
                    n.protected_label = f.protected_label.or(n.protected_label);
                    f.risk
                }
                Err(_) => Risk::High,
            }
        }
        Kind::Programs if n.scope.contains('*') => Risk::High,
        Kind::Programs => resolve(&n.scope).map_or(Risk::High, |p| max_risk(&program_needs(&p, &[]))),
        Kind::Network => Risk::High,
        Kind::AdminRights => Risk::Critical,
        Kind::Environment => Risk::Medium,
        Kind::Processes => Risk::Low,
    };
    n.risk = n.risk.max(local);
    n
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
        Request::RunCommand { command, cwd: dir, network } => {
            let first = command.first().ok_or("The command is empty.")?;
            let prog = find_program(first)?;
            if is_setuid(&prog) {
                return Err(format!(
                    "{} runs with raised privileges (setuid), and macOS won't start those inside Valet's sandbox. Use a structured tool instead, such as list_processes for ps.",
                    prog.display()
                ));
            }
            let mut needs = program_needs(&prog, command);
            if *network && !needs.iter().any(|n| n.kind == Kind::Network) {
                needs.push(network_need());
            }
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

    fn proposed(kind: Kind, access: &str, scope: &str, risk: Risk) -> Need {
        Need { kind, access: access.into(), scope: scope.into(), risk, protected_label: None }
    }

    #[test]
    fn rates_a_proposed_permission_from_its_scope_not_the_agents_label() {
        let rated = |k, a, s| rate(proposed(k, a, s, Risk::Low)).risk;
        assert_eq!(rated(Kind::Programs, "run", "/bin/zsh"), Risk::High);
        assert_eq!(rated(Kind::Programs, "run", "/usr/bin/*"), Risk::High);
        assert_eq!(rated(Kind::Programs, "run", "zsh"), Risk::High, "a bare name can't be checked");
        assert_eq!(rated(Kind::Programs, "run", "/usr/bin/uname"), Risk::Medium);
        assert_eq!(rated(Kind::Files, "write", "/usr/local/**"), Risk::High);
        assert_eq!(rated(Kind::Files, "delete", "~/Documents/**"), Risk::High);
        assert_eq!(rated(Kind::Files, "read", "*"), Risk::High);
        assert_eq!(rated(Kind::Network, "connect", "*"), Risk::High);
        assert_eq!(rated(Kind::AdminRights, "elevate", "/usr/bin/sudo"), Risk::Critical);
        assert_eq!(rated(Kind::Files, "read", "~/Library/Logs/AcmeApp/**"), Risk::Low);
        let keys = rate(proposed(Kind::Files, "read", "~/.ssh/**", Risk::Low));
        assert_eq!((keys.risk, keys.protected_label.as_deref()), (Risk::High, Some("SSH keys")));
    }

    #[test]
    fn keeps_a_higher_label_from_the_agent() {
        assert_eq!(rate(proposed(Kind::Processes, "list", "all", Risk::Medium)).risk, Risk::Medium);
    }

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
    fn a_folder_grant_may_not_reach_over_a_protected_place() {
        assert!(can_widen("~/Documents/notes.txt"));
        assert!(!can_widen("~/notes.txt"), "widening to ~ would open the SSH keys");
        assert!(!can_widen("~/Library/Application Support/acme.json"), "widening would open the browser data");
        assert!(!can_widen("/private/etc/hosts"), "widening would open sudoers");
        assert!(!can_widen("*"));
    }

    #[test]
    fn a_scope_protects_only_the_place_itself() {
        assert!(scope_protects("~/.ssh/**"));
        assert!(scope_protects("~/code/app/.env"));
        assert!(!scope_protects("~/**"));
        assert!(!scope_protects("*"));
    }

    #[test]
    fn writing_a_protected_file_is_high_risk() {
        let n = file_need(&home().join(".aws/credentials"), "write", false);
        assert_eq!(n.risk, Risk::High);
        assert_eq!(n.scope, "~/.aws/credentials");
    }

    #[test]
    fn a_shell_is_high_risk_and_admin_tools_are_critical() {
        let p = plan(Request::RunCommand { command: vec!["sh".into(), "-c".into(), "ls".into()], cwd: None, network: false }).unwrap();
        assert_eq!(p.risk, Risk::High);
        let p = plan(Request::RunCommand { command: vec!["launchctl".into(), "list".into()], cwd: None, network: false }).unwrap();
        assert_eq!(p.risk, Risk::Critical);
    }

    #[test]
    fn setuid_programs_are_turned_back_before_anyone_is_asked() {
        for prog in ["/bin/ps", "/usr/bin/sudo"] {
            let e = plan(Request::RunCommand { command: vec![prog.into()], cwd: None, network: false }).unwrap_err();
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
    fn network_programs_need_the_network() {
        let p = plan(Request::RunCommand { command: vec!["/usr/bin/curl".into(), "https://example.com".into()], cwd: None, network: false }).unwrap();
        assert!(p.needs.iter().any(|n| n.kind == Kind::Network));
        let p = plan(Request::RunCommand { command: vec!["git".into(), "status".into()], cwd: None, network: false });
        if let Ok(p) = p {
            assert!(!p.needs.iter().any(|n| n.kind == Kind::Network));
        }
    }

    #[test]
    fn a_working_folder_needs_reading_it() {
        let p = plan(Request::RunCommand { command: vec!["ls".into()], cwd: Some("/usr/share".into()), network: false }).unwrap();
        assert!(p.needs.iter().any(|n| n.kind == Kind::Files && n.scope == "/usr/share/**"));
    }

    #[test]
    fn scopes_normalise_to_the_real_path() {
        assert_eq!(normalise_scope("/tmp/**"), "/private/tmp/**");
        assert_eq!(normalise_scope("*"), "*");
        assert_eq!(normalise_scope("api.acme.com:443"), "api.acme.com:443");
    }

    #[test]
    fn a_command_that_says_it_needs_the_network_asks_for_it() {
        let p = plan(Request::RunCommand { command: vec!["sh".into()], cwd: None, network: false }).unwrap();
        assert!(!p.needs.iter().any(|n| n.kind == Kind::Network));
        let p = plan(Request::RunCommand { command: vec!["sh".into()], cwd: None, network: true }).unwrap();
        assert_eq!(p.needs.iter().filter(|n| n.kind == Kind::Network).count(), 1);
        assert_eq!(p.risk, Risk::High);
        let args = serde_json::json!({ "command": ["sh", "-c", "git fetch"], "network": true });
        assert!(matches!(Request::parse("run_command", &args), Ok(Request::RunCommand { network: true, .. })));
        let args = serde_json::json!({ "command": ["sh"] });
        assert!(matches!(Request::parse("run_command", &args), Ok(Request::RunCommand { network: false, .. })));
    }

    #[test]
    fn quotes_arguments_for_display() {
        assert_eq!(literal(&["log".into(), "show".into(), "process == \"x\"".into()]), "log show 'process == \"x\"'");
    }
}
