use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::types::{Grant, Need};

#[derive(Clone)]
pub struct Relay {
    http: reqwest::Client,
    base: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Joined {
    pub session_id: String,
    pub client_token: String,
    pub sender_name: String,
    pub purpose: String,
    pub template: Vec<Need>,
    pub created_at: i64,
    pub review_until: i64,
    // "mcp" when the agent came through the relay's MCP server; absent for the skill
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Started {
    pub ends_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InboxAction {
    pub action_id: String,
    pub seq: i64,
    pub tool: String,
    #[serde(default)]
    pub args: Value,
    #[serde(default)]
    pub reason: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Inbox {
    pub state: String,
    pub ends_at: Option<i64>,
    pub actions: Vec<InboxAction>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Status {
    pub ended_by: Option<String>,
}

#[derive(Debug)]
pub enum RelayError {
    Http { status: u16, message: String },
    Network(String),
}

impl std::fmt::Display for RelayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RelayError::Http { message, .. } => f.write_str(message),
            RelayError::Network(m) => write!(f, "Couldn't reach Valet's relay: {m}"),
        }
    }
}

impl RelayError {
    pub fn status(&self) -> Option<u16> {
        match self {
            RelayError::Http { status, .. } => Some(*status),
            RelayError::Network(_) => None,
        }
    }
}

/// Every HTTP client in the app starts here. It checks certificates with the operating system, so a root the
/// system trusts (a company's proxy, say) is trusted here too, and a certificate the system rejects is rejected.
pub fn http() -> reqwest::ClientBuilder {
    static PROVIDER: std::sync::Once = std::sync::Once::new();
    // The updater installs the same provider; only the first install sticks, and either is fine
    PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    reqwest::Client::builder()
}

/// reqwest's own message ("error sending request") hides why; the innermost causes say it (a certificate the
/// system doesn't trust, a refused connection, a proxy).
fn cause(e: &reqwest::Error) -> String {
    let mut parts = vec![e.to_string()];
    let mut source = std::error::Error::source(e);
    while let Some(s) = source {
        let s_text = s.to_string();
        if !parts.iter().any(|p| p.contains(&s_text)) {
            parts.push(s_text);
        }
        source = s.source();
    }
    parts.join(": ")
}

impl Relay {
    pub fn new(base: &str) -> Self {
        let http = http()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(65))
            .https_only(!base.starts_with("http://localhost") && !base.starts_with("http://127.0.0.1"))
            .user_agent(concat!("Valet/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self { http, base: format!("{}/api/v1", base.trim_end_matches('/')) }
    }

    async fn send<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> Result<T, RelayError> {
        let res = req.send().await.map_err(|e| RelayError::Network(cause(&e.without_url())))?;
        let status = res.status().as_u16();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return serde_json::from_value(body).map_err(|e| RelayError::Network(format!("unexpected reply: {e}")));
        }
        let message = body["error"]["message"].as_str().unwrap_or("The relay refused the request.");
        let message = match body["error"]["hint"].as_str() {
            Some(hint) if status == 429 => format!("{message} {hint}"),
            _ => message.to_string(),
        };
        Err(RelayError::Http { status, message })
    }

    fn url(&self, id: &str, path: &str) -> String {
        format!("{}/sessions/{id}{path}", self.base)
    }

    pub async fn join(&self, code: &str) -> Result<Joined, RelayError> {
        self.send(self.http.post(format!("{}/join", self.base)).json(&json!({ "code": code }))).await
    }

    pub async fn decline(&self, id: &str, token: &str) -> Result<Value, RelayError> {
        self.send(self.http.post(self.url(id, "/decline")).bearer_auth(token)).await
    }

    pub async fn start(&self, id: &str, token: &str, grants: &[Grant]) -> Result<Started, RelayError> {
        // the agent reads the platform to pick commands and paths that exist here; a relay older than it ignores it
        let platform = if cfg!(windows) { "windows" } else { "macos" };
        self.send(self.http.post(self.url(id, "/start")).bearer_auth(token).json(&json!({ "grants": grants, "platform": platform }))).await
    }

    pub async fn extend(&self, id: &str, token: &str) -> Result<Started, RelayError> {
        self.send(self.http.post(self.url(id, "/extend")).bearer_auth(token)).await
    }

    pub async fn end(&self, id: &str, token: &str) -> Result<Status, RelayError> {
        self.send(self.http.post(self.url(id, "/end")).bearer_auth(token)).await
    }

    pub async fn status(&self, id: &str, token: &str) -> Result<Status, RelayError> {
        self.send(self.http.get(self.url(id, "")).bearer_auth(token)).await
    }

    pub async fn inbox(&self, id: &str, token: &str, after: i64, wait: u32) -> Result<Inbox, RelayError> {
        let url = self.url(id, &format!("/inbox?after={after}&wait={wait}"));
        self.send(self.http.get(url).bearer_auth(token)).await
    }

    pub async fn result(&self, id: &str, token: &str, aid: &str, body: &Value) -> Result<Value, RelayError> {
        self.send(self.http.post(self.url(id, &format!("/actions/{aid}/result"))).bearer_auth(token).json(body)).await
    }

    pub async fn grants(&self, id: &str, token: &str, grants: &[Grant]) -> Result<Value, RelayError> {
        self.send(self.http.put(self.url(id, "/grants")).bearer_auth(token).json(&json!({ "grants": grants }))).await
    }

    // The relay only takes the sealed log once it holds the session as ended.
    pub async fn put_log(&self, id: &str, token: &str, log: &Value) -> Result<Value, RelayError> {
        self.send(self.http.put(self.url(id, "/log")).bearer_auth(token).json(log)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_where_a_session_came_from_and_does_without() {
        let base = json!({
            "session_id": "s", "client_token": "t", "sender_name": "Acme", "purpose": "Fix it.",
            "template": [], "created_at": 1, "review_until": 2,
        });
        let plain: Joined = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(plain.source, None);
        let mut via = base;
        via["source"] = json!("mcp");
        let mcp: Joined = serde_json::from_value(via).unwrap();
        assert_eq!(mcp.source.as_deref(), Some("mcp"));
    }
}
