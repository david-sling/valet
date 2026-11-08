use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::session::{FeedItem, Phase, SessionView};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  phase TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  verified INTEGER NOT NULL,
  template TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  review_until INTEGER NOT NULL,
  started_at INTEGER,
  ends_at INTEGER,
  ended_at INTEGER,
  ended_by TEXT,
  grants TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (session_id, id)
);
PRAGMA user_version = 1;
";

pub struct Store {
    db: Mutex<Connection>,
}

fn phase_name(p: Phase) -> &'static str {
    match p {
        Phase::Joined => "joined",
        Phase::Live => "live",
        Phase::Ended => "ended",
        Phase::Declined => "declined",
    }
}

// Output and file contents stay out of the database; the record keeps what was done and how it was decided.
pub fn without_content(item: &FeedItem) -> FeedItem {
    let mut item = item.clone();
    if let FeedItem::Action { output, diff, .. } = &mut item {
        *output = None;
        *diff = None;
    }
    item
}

impl Store {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        // On Windows the app data folder is already private to the person; on macOS the modes make it so
        #[cfg(unix)]
        {
            use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
            if let Some(dir) = path.parent() {
                let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir);
            }
            let _ = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(path);
        }
        #[cfg(windows)]
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        Self::init(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn init(conn: Connection) -> rusqlite::Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self { db: Mutex::new(conn) })
    }

    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn save(&self, s: &SessionView, new_items: &[FeedItem]) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO sessions (id, phase, sender_name, purpose, verified, template, created_at, review_until,
               started_at, ends_at, ended_at, ended_by, grants)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(id) DO UPDATE SET phase = ?2, started_at = ?9, ends_at = ?10, ended_at = ?11, ended_by = ?12,
               grants = ?13",
            params![
                s.id,
                phase_name(s.phase),
                s.sender_name,
                s.purpose,
                s.verified,
                serde_json::to_string(&s.template).unwrap_or_default(),
                s.created_at,
                s.review_until,
                s.started_at,
                s.ends_at,
                s.ended_at,
                s.ended_by,
                serde_json::to_string(&s.grants).unwrap_or_default(),
            ],
        )?;
        for item in new_items {
            let id = match item {
                FeedItem::Event { id, .. } | FeedItem::Action { id, .. } => *id,
            };
            tx.execute(
                "INSERT OR IGNORE INTO feed (session_id, id, item) VALUES (?1, ?2, ?3)",
                params![s.id, id as i64, serde_json::to_string(&without_content(item)).unwrap_or_default()],
            )?;
        }
        tx.commit()
    }

    pub fn forget(&self, id: &str) -> rusqlite::Result<()> {
        self.conn().execute("DELETE FROM sessions WHERE id = ?1", params![id]).map(|_| ())
    }

    pub fn load(&self) -> rusqlite::Result<Vec<SessionView>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, phase, sender_name, purpose, verified, template, created_at, review_until, started_at, ends_at,
               ended_at, ended_by, grants
             FROM sessions WHERE phase != 'declined' ORDER BY created_at DESC",
        )?;
        let mut sessions: Vec<(SessionView, String)> = stmt
            .query_map([], |r| {
                let phase: String = r.get(1)?;
                Ok((
                    SessionView {
                        id: r.get(0)?,
                        phase: Phase::Ended,
                        sender_name: r.get(2)?,
                        purpose: r.get(3)?,
                        verified: r.get(4)?,
                        template: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
                        created_at: r.get(6)?,
                        review_until: r.get(7)?,
                        started_at: r.get(8)?,
                        ends_at: r.get(9)?,
                        ended_at: r.get(10)?,
                        ended_by: r.get(11)?,
                        grants: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
                        feed: vec![],
                        prompts: vec![],
                    },
                    phase,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut feed = conn.prepare("SELECT item FROM feed WHERE session_id = ?1 ORDER BY id")?;
        for (s, phase) in &mut sessions {
            s.feed = feed
                .query_map(params![s.id], |r| r.get::<_, String>(0))?
                .filter_map(|j| j.ok().and_then(|j| serde_json::from_str(&j).ok()))
                .collect();
            s.grants.iter_mut().for_each(|g| g.on = false);
            if phase != "ended" {
                s.ended_by = Some("closed".into());
                s.ended_at = s.ended_at.or(s.feed.iter().rev().find_map(|f| match f {
                    FeedItem::Event { at, .. } | FeedItem::Action { at, .. } => Some(*at),
                }));
            }
        }
        Ok(sessions
            .into_iter()
            .filter(|(s, phase)| phase == "ended" || s.started_at.is_some())
            .map(|(s, _)| s)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(phase: Phase) -> SessionView {
        SessionView {
            id: "s1".into(),
            phase,
            sender_name: "Acme".into(),
            purpose: "Fix it.".into(),
            verified: false,
            template: vec![],
            created_at: 1,
            review_until: 2,
            started_at: Some(3),
            ends_at: Some(4),
            ended_at: None,
            ended_by: None,
            grants: vec![],
            feed: vec![],
            prompts: vec![],
        }
    }

    #[test]
    fn keeps_what_happened_but_not_the_content() {
        let store = Store::memory();
        let action = FeedItem::Action {
            id: 7,
            at: 5,
            tool: "read_file".into(),
            literal: "~/notes.txt".into(),
            outcome: "Allowed".into(),
            method: None,
            output: Some("secret contents".into()),
            diff: Some(vec!["+secret".into()]),
            note: None,
        };
        store.save(&view(Phase::Live), &[action]).unwrap();
        let mut ended = view(Phase::Ended);
        ended.ended_at = Some(9);
        ended.ended_by = Some("client".into());
        store.save(&ended, &[]).unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].ended_by.as_deref(), Some("client"));
        let FeedItem::Action { output, diff, literal, .. } = &loaded[0].feed[0] else { panic!("no action") };
        assert_eq!((output, diff, literal.as_str()), (&None, &None, "~/notes.txt"));
    }

    #[test]
    fn a_session_cut_off_by_a_crash_loads_as_ended() {
        let store = Store::memory();
        store.save(&view(Phase::Live), &[FeedItem::Event { id: 1, at: 6, text: "Session started".into() }]).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!((loaded[0].phase, loaded[0].ended_at, loaded[0].ended_by.as_deref()), (Phase::Ended, Some(6), Some("closed")));
    }

    #[test]
    fn forgets_a_declined_session() {
        let store = Store::memory();
        store.save(&view(Phase::Joined), &[]).unwrap();
        store.forget("s1").unwrap();
        assert!(store.load().unwrap().is_empty());
    }
}
