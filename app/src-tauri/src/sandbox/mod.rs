// Every command an agent sends runs inside the operating system's sandbox, holding only what the session grants.
// macOS uses sandbox-exec with a deny-by-default profile; Windows uses a fresh AppContainer per command inside a Job Object.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt};

use crate::needs::{home, search_path};
use crate::types::{now_ms, Grant, Kind, Need, Source};

#[cfg(unix)]
mod macos;
#[cfg(unix)]
pub use macos::run;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use self::windows::run;

const OUTPUT_CAP: usize = 256 * 1024;
const WALL_LIMIT: Duration = Duration::from_secs(300);
const CPU_SECONDS: u64 = 300;

pub enum Ran {
    Done(Value),
    Blocked(Value),
    Failed(String),
    Stopped,
}

struct Allowed<'a> {
    need: &'a Need,
    approved: bool,
}

// Grants that are on and unexpired, plus what the person approved for this one action
fn live<'a>(grants: &'a [Grant], approved: &'a [Need]) -> Vec<Allowed<'a>> {
    let now = now_ms();
    grants
        .iter()
        .filter(|g| g.on && g.expires_at.is_none_or(|at| at >= now))
        .map(|g| Allowed { need: &g.need, approved: g.source == Source::Approved })
        .chain(approved.iter().map(|n| Allowed { need: n, approved: true }))
        .collect()
}

fn same_name(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}

// Windows programs need these to start at all; none of them hold anything private
#[cfg(windows)]
const PASSED: &[&str] = &[
    "SystemRoot", "SystemDrive", "windir", "ComSpec", "PATHEXT", "OS", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
    "USERNAME", "USERDOMAIN", "COMPUTERNAME", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData",
    "CommonProgramFiles", "CommonProgramFiles(x86)", "CommonProgramW6432", "PUBLIC", "ALLUSERSPROFILE",
    // Windows needs these to start an AppContainer, and points the ones inside the profile at the container's own folder
    "LOCALAPPDATA", "APPDATA", "HOMEDRIVE", "HOMEPATH",
];

fn environment(grants: &[Grant], tmp: &Path) -> Vec<(String, String)> {
    let now = now_ms();
    let names: Vec<&str> = grants
        .iter()
        .filter(|g| g.on && g.need.kind == Kind::Environment && g.expires_at.is_none_or(|at| at >= now))
        .map(|g| g.need.scope.as_str())
        .collect();
    let granted = |k: &str| names.contains(&"*") || names.iter().any(|n| same_name(n, k));
    #[cfg(windows)]
    let passed = |k: &str| PASSED.iter().any(|n| same_name(n, k));
    #[cfg(unix)]
    let passed = |_: &str| false;
    let mut env: Vec<(String, String)> = std::env::vars()
        .filter(|(k, _)| granted(k) || passed(k))
        .filter(|(k, _)| !k.to_ascii_uppercase().starts_with("VALET_"))
        .collect();
    let tmp_dir = tmp.display().to_string();
    let path = std::env::join_paths(search_path()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    #[cfg(unix)]
    let fixed = [("PATH", path), ("HOME", home().display().to_string()), ("TMPDIR", format!("{tmp_dir}/"))];
    #[cfg(windows)]
    let fixed = [("PATH", path), ("USERPROFILE", home().display().to_string()), ("TEMP", tmp_dir.clone()), ("TMP", tmp_dir)];
    env.retain(|(k, _)| !fixed.iter().any(|(f, _)| same_name(f, k)));
    env.extend(fixed.into_iter().map(|(k, v)| (k.to_string(), v)));
    if cfg!(unix) && !env.iter().any(|(k, _)| k == "LANG") {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Risk;

    fn env_grant(name: &str) -> Grant {
        Grant {
            id: "e".into(),
            on: true,
            source: Source::Proposed,
            need: Need { kind: Kind::Environment, access: "read".into(), scope: name.into(), risk: Risk::Low, protected_label: None },
            expires_at: None,
        }
    }

    #[test]
    fn only_granted_variables_pass_and_valet_ones_never_do() {
        std::env::set_var("VALET_TEST_SECRET", "x");
        std::env::set_var("VALET_GRANTED_ONE", "y");
        let tmp = std::env::temp_dir();
        let env = environment(&[env_grant("*")], &tmp);
        assert!(!env.iter().any(|(k, _)| k.starts_with("VALET_")));
        let env = environment(&[], &tmp);
        assert!(!env.iter().any(|(k, _)| k == "VALET_GRANTED_ONE"));
        assert_eq!(env.iter().filter(|(k, _)| k.eq_ignore_ascii_case("PATH")).count(), 1);
    }
}
