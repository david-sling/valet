use serde::{Deserialize, Serialize};

use crate::types::{Grant, Kind, Need, Risk, Source};

pub fn max_risk(needs: &[Need]) -> Risk {
    needs.iter().map(|n| n.risk).max().unwrap_or(Risk::Low)
}

pub fn covers(g: &Grant, n: &Need, now: i64) -> bool {
    if !g.on || g.need.kind != n.kind || g.need.access != n.access {
        return false;
    }
    if g.expires_at.is_some_and(|at| at < now) {
        return false;
    }
    if n.protected_label.is_some() && g.source != Source::Approved {
        return false;
    }
    let scope = g.need.scope.as_str();
    if scope == n.scope || scope == "*" {
        return true;
    }
    match scope.strip_suffix("/**") {
        Some(folder) => n.scope == folder || n.scope.starts_with(&scope[..scope.len() - 2]),
        None => false,
    }
}

pub fn decide(risk: Risk, needs: &[Need], grants: &[Grant], now: i64) -> Vec<Need> {
    if risk == Risk::Critical {
        return needs.to_vec();
    }
    needs
        .iter()
        .filter(|n| {
            !grants
                .iter()
                .any(|g| covers(g, n, now) && (risk != Risk::High || g.source == Source::Approved))
        })
        .cloned()
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Scope {
    #[serde(rename = "once")]
    Once,
    #[serde(rename = "check")]
    Check,
    #[serde(rename = "session")]
    Session,
    #[serde(rename = "15m")]
    Minutes15,
    #[serde(rename = "folder")]
    Folder,
}

pub fn scopes_for(risk: Risk, needs: &[Need]) -> Vec<Scope> {
    if risk == Risk::Critical {
        return vec![Scope::Once, Scope::Check];
    }
    let mut s = vec![Scope::Once, Scope::Check, Scope::Session, Scope::Minutes15];
    if needs.iter().any(|n| n.kind == Kind::Files) {
        s.push(Scope::Folder);
    }
    s
}

pub fn grants_from(needs: &[Need], scope: Scope, now: i64) -> Vec<(Need, Option<i64>)> {
    if matches!(scope, Scope::Once | Scope::Check) {
        return vec![];
    }
    needs
        .iter()
        .map(|n| {
            let mut n = n.clone();
            if scope == Scope::Folder && n.kind == Kind::Files {
                n.scope = match n.scope.rfind('/') {
                    Some(i) => format!("{}/**", &n.scope[..i]),
                    None => n.scope,
                };
            }
            (n, (scope == Scope::Minutes15).then_some(now + 15 * 60_000))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    #[derive(Deserialize)]
    struct Action {
        risk: Risk,
        needs: Vec<Need>,
    }
    #[derive(Deserialize)]
    struct DecideCase {
        name: String,
        action: Action,
        grants: Vec<Grant>,
        expect: Value,
    }
    #[derive(Deserialize)]
    struct ScopesCase {
        name: String,
        action: Action,
        expect: Vec<Scope>,
    }
    #[derive(Deserialize)]
    struct FromCase {
        name: String,
        needs: Vec<Need>,
        scope: Scope,
        expect: Vec<Value>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vectors {
        now: i64,
        decide: Vec<DecideCase>,
        scopes_for: Vec<ScopesCase>,
        grants_from: Vec<FromCase>,
    }

    fn vectors() -> Vectors {
        serde_json::from_str(include_str!("../../../packages/protocol/vectors/policy.json")).unwrap()
    }

    #[test]
    fn decide_matches_vectors() {
        let v = vectors();
        for c in v.decide {
            let asked = decide(c.action.risk, &c.action.needs, &c.grants, v.now);
            let got = if asked.is_empty() {
                serde_json::json!({ "ask": false })
            } else {
                serde_json::json!({ "ask": true, "needs": asked })
            };
            assert_eq!(got, c.expect, "{}", c.name);
        }
    }

    #[test]
    fn scopes_match_vectors() {
        for c in vectors().scopes_for {
            assert_eq!(scopes_for(c.action.risk, &c.action.needs), c.expect, "{}", c.name);
        }
    }

    #[test]
    fn grants_from_matches_vectors() {
        let v = vectors();
        for c in v.grants_from {
            let got: Vec<Value> = grants_from(&c.needs, c.scope, v.now)
                .into_iter()
                .map(|(n, at)| {
                    let mut j = serde_json::to_value(n).unwrap();
                    if let Some(at) = at {
                        j["expiresAt"] = at.into();
                    }
                    j
                })
                .collect();
            assert_eq!(got, c.expect, "{}", c.name);
        }
    }
}
