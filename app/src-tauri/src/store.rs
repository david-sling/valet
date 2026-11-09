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
";

// Each entry moves the database up one version from the one before
const MIGRATIONS: &[&str] = &[
    "",
    "ALTER TABLE sessions ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;",
    "CREATE TABLE IF NOT EXISTS logs (
       session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
       log TEXT NOT NULL
     );",
    "ALTER TABLE sessions ADD COLUMN source TEXT;",
];

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
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        if let Some(dir) = path.parent() {
            let _ = std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir);
        }
        let _ = std::fs::OpenOptions::new().create(true).append(true).mode(0o600).open(path);
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
        let version: usize = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (i, step) in MIGRATIONS.iter().enumerate().skip(version) {
            conn.execute_batch(&format!("BEGIN; {step} PRAGMA user_version = {}; COMMIT;", i + 1))?;
        }
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
               started_at, ends_at, ended_at, ended_by, grants, source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
                s.source,
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

    // The sealed log holds no output, no file contents and no token, so it keeps the same company as the rest of the record.
    pub fn save_log(&self, id: &str, log: &str) -> rusqlite::Result<()> {
        self.conn()
            .execute("INSERT OR REPLACE INTO logs (session_id, log) VALUES (?1, ?2)", params![id, log])
            .map(|_| ())
    }

    pub fn load_log(&self, id: &str) -> Option<String> {
        self.conn().query_row("SELECT log FROM logs WHERE session_id = ?1", params![id], |r| r.get(0)).ok()
    }

    pub fn set_kept(&self, id: &str, kept: bool) -> rusqlite::Result<()> {
        self.conn().execute("UPDATE sessions SET kept = ?2 WHERE id = ?1", params![id, kept]).map(|_| ())
    }

    // secure_delete zeroes the freed pages; the checkpoint clears the copies the WAL still holds
    pub fn forget(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
    }

    pub fn load(&self) -> rusqlite::Result<Vec<SessionView>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, phase, sender_name, purpose, verified, template, created_at, review_until, started_at, ends_at,
               ended_at, ended_by, grants, kept, source
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
                        kept: r.get(13)?,
                        grants: serde_json::from_str(&r.get::<_, String>(12)?).unwrap_or_default(),
                        feed: vec![],
                        prompts: vec![],
                        source: r.get(14)?,
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
            kept: false,
            grants: vec![],
            feed: vec![],
            prompts: vec![],
            source: None,
        }
    }

    #[test]
    fn keeps_where_the_session_came_from() {
        let store = Store::memory();
        let mut mcp = view(Phase::Live);
        mcp.source = Some("mcp".into());
        store.save(&mcp, &[]).unwrap();
        let mut skill = view(Phase::Live);
        skill.id = "s2".into();
        store.save(&skill, &[]).unwrap();

        let loaded = store.load().unwrap();
        let source = |id: &str| loaded.iter().find(|s| s.id == id).and_then(|s| s.source.clone());
        assert_eq!(source("s1").as_deref(), Some("mcp"));
        assert_eq!(source("s2"), None);
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
    fn forgetting_a_session_removes_its_activity() {
        let store = Store::memory();
        let mut ended = view(Phase::Ended);
        ended.ended_at = Some(9);
        store.save(&ended, &[FeedItem::Event { id: 1, at: 6, text: "Session started".into() }]).unwrap();
        store.save_log("s1", "{\"format\":\"valet-sealed-log\"}").unwrap();
        assert!(store.load_log("s1").is_some());
        store.forget("s1").unwrap();
        assert!(store.load().unwrap().is_empty());
        let rows: i64 = store.conn().query_row("SELECT COUNT(*) FROM feed", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        assert_eq!(store.load_log("s1"), None, "the sealed log goes with the session");
    }

    #[test]
    fn adds_the_kept_column_to_a_version_1_database() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        let store = Store::init(conn).unwrap();
        let mut ended = view(Phase::Ended);
        ended.ended_at = Some(9);
        store.save(&ended, &[]).unwrap();
        store.set_kept("s1", true).unwrap();
        assert!(store.load().unwrap()[0].kept);
        let version: i64 = store.conn().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    #[test]
    fn forgets_a_declined_session() {
        let store = Store::memory();
        store.save(&view(Phase::Joined), &[]).unwrap();
        store.forget("s1").unwrap();
        assert!(store.load().unwrap().is_empty());
    }
}
