use serde_json::{json, Value};

use crate::session::{Phase, SessionView};
use crate::store::without_content;

pub fn record(s: &SessionView, app_version: &str, exported_at: i64) -> Option<Value> {
    if s.phase != Phase::Ended {
        return None;
    }
    Some(json!({
        "format": "valet-session-record",
        "version": 1,
        "exportedAt": exported_at,
        "appVersion": app_version,
        "session": {
            "id": s.id,
            "requestedBy": s.sender_name,
            "purpose": s.purpose,
            "verified": s.verified,
            "proposedPermissions": s.template,
            "createdAt": s.created_at,
            "startedAt": s.started_at,
            "endedAt": s.ended_at,
            "endedBy": s.ended_by,
            "activity": s.feed.iter().map(without_content).collect::<Vec<_>>(),
        },
    }))
}

pub fn file_name(name: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_control() || "/\\:".contains(c) { '-' } else { c }).collect();
    let clean = clean.trim().trim_start_matches('.');
    if clean.is_empty() { "Valet session.json".into() } else { clean.into() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::FeedItem;

    fn ended(feed: Vec<FeedItem>) -> SessionView {
        SessionView {
            id: "s1".into(),
            phase: Phase::Ended,
            sender_name: "Acme".into(),
            purpose: "Fix it".into(),
            verified: false,
            template: vec![],
            created_at: 1,
            review_until: 2,
            started_at: Some(3),
            ends_at: Some(4),
            ended_at: Some(5),
            ended_by: Some("client".into()),
            kept: false,
            grants: vec![],
            feed,
            prompts: vec![],
        }
    }

    #[test]
    fn leaves_output_and_diffs_out() {
        let s = ended(vec![FeedItem::Action {
            id: 1,
            at: 3,
            tool: "read_file".into(),
            literal: "read ~/a".into(),
            outcome: "Allowed".into(),
            method: None,
            output: Some("secret contents".into()),
            diff: Some(vec!["+x".into()]),
            note: None,
        }]);
        let r = record(&s, "0.1.1", 9).unwrap();
        let text = r.to_string();
        assert!(!text.contains("secret contents") && !text.contains("\"diff\""));
        assert_eq!(r["session"]["activity"][0]["literal"], "read ~/a");
    }

    #[test]
    fn only_exports_ended_sessions() {
        let mut s = ended(vec![]);
        s.phase = Phase::Live;
        assert!(record(&s, "0.1.1", 9).is_none());
    }

    #[test]
    fn keeps_file_names_to_one_folder() {
        assert_eq!(file_name("Acme/Corp: 7 Nov.json"), "Acme-Corp- 7 Nov.json");
        assert_eq!(file_name("../.."), "-..");
        assert_eq!(file_name("  "), "Valet session.json");
    }
}
