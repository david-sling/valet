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

impl Relay {
    pub fn new(base: &str) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(65))
            .https_only(!base.starts_with("http://localhost") && !base.starts_with("http://127.0.0.1"))
            .user_agent(concat!("Valet/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("http client");
        Self { http, base: format!("{}/api/v1", base.trim_end_matches('/')) }
    }

    async fn send<T: DeserializeOwned>(&self, req: reqwest::RequestBuilder) -> Result<T, RelayError> {
        let res = req.send().await.map_err(|e| RelayError::Network(e.without_url().to_string()))?;
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
        self.send(self.http.post(self.url(id, "/start")).bearer_auth(token).json(&json!({ "grants": grants }))).await
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
}
