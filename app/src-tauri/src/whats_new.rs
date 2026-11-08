use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};

const RELEASES: &str = "https://api.github.com/repos/david-sling/valet/releases?per_page=30";
const SEEN_FILE: &str = "seen-version";
// The release workflow puts this under every release's notes; it's for the download page, not news.
const INSTALL_NOTE: &str = "Signed and notarised for macOS 13 or later, on Apple silicon and Intel.";

// Some(since) until the notes are shown; since is None when the update came from a version that kept no record.
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Option<Version>>>);

#[derive(Deserialize)]
pub struct Release {
    tag_name: String,
    body: Option<String>,
    draft: bool,
    prerelease: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Note {
    version: String,
    body: String,
}

// fresh: no earlier install left data behind, so this is a first install and there's nothing to announce.
pub fn on_launch(dir: &Path, current: &Version, fresh: bool) -> Option<Option<Version>> {
    let seen = std::fs::read_to_string(dir.join(SEEN_FILE)).ok().and_then(|s| Version::parse(s.trim()).ok());
    match seen {
        Some(v) if v < *current => Some(Some(v)),
        Some(v) if v == *current => None,
        None if !fresh => Some(None),
        _ => {
            record(dir, current);
            None
        }
    }
}

pub fn record(dir: &Path, current: &Version) {
    let _ = std::fs::write(dir.join(SEEN_FILE), current.to_string());
}

pub async fn fetch() -> Result<Vec<Release>, String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("Valet/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let res = http.get(RELEASES).header("accept", "application/vnd.github+json").send().await.map_err(|e| e.without_url().to_string())?;
    res.error_for_status().map_err(|e| e.without_url().to_string())?.json().await.map_err(|e| e.without_url().to_string())
}

// Newest first: every published release after since, up to and including current.
pub fn pick(releases: Vec<Release>, since: Option<&Version>, current: &Version) -> Vec<Note> {
    let mut notes: Vec<(Version, String)> = releases
        .into_iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| {
            let v = Version::parse(r.tag_name.strip_prefix("app-v")?).ok()?;
            let wanted = v <= *current && since.map_or(v == *current, |s| v > *s);
            let body = r.body.unwrap_or_default().replace("\r\n", "\n").replace(INSTALL_NOTE, "").trim().to_string();
            (wanted && !body.is_empty()).then_some((v, body))
        })
        .collect();
    notes.sort_by(|a, b| b.0.cmp(&a.0));
    notes.into_iter().map(|(v, body)| Note { version: v.to_string(), body }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    fn release(tag: &str, body: &str) -> Release {
        Release { tag_name: tag.into(), body: Some(body.into()), draft: false, prerelease: false }
    }

    fn versions(notes: &[Note]) -> Vec<&str> {
        notes.iter().map(|n| n.version.as_str()).collect()
    }

    #[test]
    fn picks_releases_since_the_last_seen_version() {
        let releases = vec![
            release("app-v0.1.8", "later"),
            release("app-v0.1.7", "seven"),
            release("app-v0.1.6", "six"),
            release("app-v0.1.5", "five"),
            release("web-v0.1.6", "not the app"),
        ];
        assert_eq!(versions(&pick(releases, Some(&v("0.1.5")), &v("0.1.7"))), ["0.1.7", "0.1.6"]);
    }

    #[test]
    fn without_a_record_only_the_current_release_shows() {
        let releases = vec![release("app-v0.1.7", "seven"), release("app-v0.1.6", "six")];
        assert_eq!(versions(&pick(releases, None, &v("0.1.7"))), ["0.1.7"]);
    }

    #[test]
    fn skips_drafts_prereleases_and_notes_that_are_only_the_install_line() {
        let mut draft = release("app-v0.1.7", "draft");
        draft.draft = true;
        let mut pre = release("app-v0.1.6", "pre");
        pre.prerelease = true;
        let releases = vec![draft, pre, release("app-v0.1.5", &format!("\r\n{INSTALL_NOTE}\r\n"))];
        assert!(pick(releases, Some(&v("0.1.0")), &v("0.1.7")).is_empty());
    }

    #[test]
    fn strips_the_install_line_from_real_notes() {
        let notes = pick(vec![release("app-v0.1.7", &format!("- Faster joins\r\n\r\n{INSTALL_NOTE}"))], None, &v("0.1.7"));
        assert_eq!(notes, [Note { version: "0.1.7".into(), body: "- Faster joins".into() }]);
    }

    #[test]
    fn launch_shows_nothing_on_a_first_install_and_records_it() {
        let dir = std::env::temp_dir().join(format!("valet-whats-new-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let _ = std::fs::remove_file(dir.join(SEEN_FILE));
        assert_eq!(on_launch(&dir, &v("0.1.7"), true), None);
        assert_eq!(on_launch(&dir, &v("0.1.7"), false), None);
        assert_eq!(on_launch(&dir, &v("0.1.8"), false), Some(Some(v("0.1.7"))));
        std::fs::remove_file(dir.join(SEEN_FILE)).unwrap();
        assert_eq!(on_launch(&dir, &v("0.1.8"), false), Some(None));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
