use ed25519_dalek::{Signature, Signer as _, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::tools::sha256;
use crate::types::now_ms;

pub const FORMAT: &str = "valet-sealed-log";
const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const SERVICE: &str = "in.davidsling.valet";
const ACCOUNT: &str = "audit-signing-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub seq: u64,
    pub at: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub data: Value,
    pub prev_hash: String,
    pub hash: String,
}

// One text for one value, whatever order the fields were written in: object keys sorted, no whitespace.
pub fn canonical(v: &Value) -> String {
    let mut out = String::new();
    write_canonical(v, &mut out);
    out
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(k.clone()).to_string());
                out.push(':');
                write_canonical(&map[k], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn body(seq: u64, at: i64, kind: &str, data: &Value, prev_hash: &str) -> Value {
    json!({ "seq": seq, "at": at, "type": kind, "data": data, "prev_hash": prev_hash })
}

#[derive(Default)]
pub struct Log {
    entries: Vec<Entry>,
}

impl Log {
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn head(&self) -> String {
        self.entries.last().map(|e| e.hash.clone()).unwrap_or_else(|| GENESIS.into())
    }

    pub fn append(&mut self, kind: &str, data: Value) {
        let (seq, at, prev_hash) = (self.entries.len() as u64 + 1, now_ms(), self.head());
        let hash = sha256(canonical(&body(seq, at, kind, &data, &prev_hash)).as_bytes());
        self.entries.push(Entry { seq, at, kind: kind.into(), data, prev_hash, hash });
    }

    pub fn seal(&self, session_id: &str, signer: &Signer, sealed_at: i64) -> Value {
        let seal = json!({
            "session_id": session_id,
            "sealed_at": sealed_at,
            "final_hash": self.head(),
            "public_key": signer.public_key(),
        });
        json!({
            "format": FORMAT,
            "version": 1,
            "algorithm": "ed25519",
            "app_version": env!("CARGO_PKG_VERSION"),
            "entries": self.entries,
            "seal": seal,
            "signature": signer.sign(canonical(&seal).as_bytes()),
        })
    }
}

// Walks the chain from its first entry and checks the signature over the seal. It says the log is the one that was
// sealed by the holder of that public key, not who that holder is: with no accounts there is nobody to ask.
pub fn verify(log: &Value) -> Result<(), String> {
    if log["format"] != FORMAT || log["version"] != 1 || log["algorithm"] != "ed25519" {
        return Err("That isn't a sealed Valet log.".into());
    }
    let entries: Vec<Entry> =
        serde_json::from_value(log["entries"].clone()).map_err(|e| format!("The entries are malformed: {e}"))?;
    let mut prev = GENESIS.to_string();
    for (i, e) in entries.iter().enumerate() {
        if e.seq != i as u64 + 1 {
            return Err(format!("Entry {} is out of order.", i + 1));
        }
        if e.prev_hash != prev {
            return Err(format!("Entry {} doesn't follow the one before it.", e.seq));
        }
        if e.hash != sha256(canonical(&body(e.seq, e.at, &e.kind, &e.data, &e.prev_hash)).as_bytes()) {
            return Err(format!("Entry {} has changed since it was written.", e.seq));
        }
        prev = e.hash.clone();
    }
    let seal = &log["seal"];
    if seal["final_hash"] != Value::String(prev) {
        return Err("The seal doesn't cover the last entry.".into());
    }
    let key = bytes::<32>(seal["public_key"].as_str().unwrap_or_default()).ok_or("The public key is malformed.")?;
    let key = VerifyingKey::from_bytes(&key).map_err(|_| "The public key is malformed.".to_string())?;
    let signature = bytes::<64>(log["signature"].as_str().unwrap_or_default()).ok_or("The signature is malformed.")?;
    key.verify_strict(canonical(seal).as_bytes(), &Signature::from_bytes(&signature))
        .map_err(|_| "The signature doesn't match the log.".to_string())
}

fn bytes<const N: usize>(hex: &str) -> Option<[u8; N]> {
    hex::decode(hex).ok()?.try_into().ok()
}

// Arguments belong in the log, but a write's content never does: its size and hash stand in for it.
pub fn safe_args(args: &Value) -> Value {
    let mut args = args.clone();
    if let Some(map) = args.as_object_mut() {
        if let Some(Value::String(content)) = map.remove("content") {
            map.insert("content_bytes".into(), content.len().into());
            map.insert("content_hash".into(), sha256(content.as_bytes()).into());
        }
    }
    args
}

// What an action produced, without what it said.
pub fn output_facts(text: &str, truncated: bool) -> Value {
    json!({ "bytes": text.len(), "hash": sha256(text.as_bytes()), "truncated": truncated })
}

pub struct Signer {
    key: SigningKey,
}

impl Signer {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self { key: SigningKey::from_bytes(&seed) }
    }

    pub fn public_key(&self) -> String {
        hex::encode(self.key.verifying_key().to_bytes())
    }

    pub fn sign(&self, message: &[u8]) -> String {
        hex::encode(self.key.sign(message).to_bytes())
    }
}

// The seed stays in the login keychain, off iCloud and on this Mac only. It is the app's own key, so the app can read
// it without asking: it signs the log, it never unlocks anything.
#[cfg(target_os = "macos")]
pub fn device_signer() -> Result<Signer, String> {
    use security_framework::passwords::{generic_password, set_generic_password_options, PasswordOptions};
    use security_framework::random::SecRandom;

    let options = || {
        let mut o = PasswordOptions::new_generic_password(SERVICE, ACCOUNT);
        o.set_access_synchronized(Some(false));
        o.set_label("Valet audit log signing key");
        o
    };
    if let Ok(Ok(seed)) = generic_password(options()).map(<[u8; 32]>::try_from) {
        return Ok(Signer::from_seed(seed));
    }
    let mut seed = [0u8; 32];
    SecRandom::default().copy_bytes(&mut seed).map_err(|e| format!("Couldn't make a signing key: {e}"))?;
    set_generic_password_options(&seed, options()).map_err(|e| format!("Couldn't save the signing key: {e}"))?;
    Ok(Signer::from_seed(seed))
}

#[cfg(not(target_os = "macos"))]
pub fn device_signer() -> Result<Signer, String> {
    let _ = (SERVICE, ACCOUNT);
    Err("Sealing the log needs the macOS Keychain.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer() -> Signer {
        Signer::from_seed([7; 32])
    }

    fn sealed() -> Value {
        let mut log = Log::default();
        log.append("session.start", json!({ "purpose": "Fix the printer.", "grants": [] }));
        log.append("action", json!({ "tool": "read_file", "args": { "path": "~/notes.txt" } }));
        log.append("session.end", json!({ "ended_by": "client" }));
        log.seal("s1", &signer(), 9)
    }

    #[test]
    fn one_value_has_one_canonical_text() {
        let a = json!({ "b": 1, "a": { "d": [1, 2], "c": "x" } });
        let b = json!({ "a": { "c": "x", "d": [1, 2] }, "b": 1 });
        assert_eq!(canonical(&a), canonical(&b));
        assert_eq!(canonical(&a), r#"{"a":{"c":"x","d":[1,2]},"b":1}"#);
        assert_eq!(canonical(&json!({ "q\"\n": null })), "{\"q\\\"\\n\":null}");
    }

    #[test]
    fn a_sealed_log_verifies() {
        let log = sealed();
        assert!(verify(&log).is_ok(), "{:?}", verify(&log));
        assert_eq!(log["entries"][0]["prev_hash"], GENESIS);
        assert_eq!(log["entries"][1]["prev_hash"], log["entries"][0]["hash"]);
        assert_eq!(log["seal"]["final_hash"], log["entries"][2]["hash"]);
        assert_eq!(log["seal"]["public_key"], signer().public_key());
    }

    #[test]
    fn a_changed_entry_breaks_the_chain() {
        let changed = |f: fn(&mut Value)| {
            let mut log = sealed();
            f(&mut log);
            verify(&log).unwrap_err()
        };
        changed(|l| l["entries"][1]["data"]["args"]["path"] = "~/.ssh/id_rsa".into());
        changed(|l| l["entries"][1]["at"] = 1.into());
        changed(|l| l["entries"][1]["type"] = "decision".into());
        // rewriting the entry's own hash to match only moves the break to the entry after it
        changed(|l| {
            l["entries"][0]["data"] = json!({});
            let body = body(1, l["entries"][0]["at"].as_i64().unwrap(), "session.start", &json!({}), GENESIS);
            l["entries"][0]["hash"] = sha256(canonical(&body).as_bytes()).into();
        });
        changed(|l| {
            let entries = l["entries"].as_array_mut().unwrap();
            entries.remove(1);
        });
        changed(|l| {
            let entries = l["entries"].as_array_mut().unwrap();
            entries.swap(0, 1);
        });
    }

    #[test]
    fn the_signature_covers_the_sealed_chain() {
        let mut log = sealed();
        log["signature"] = Signer::from_seed([8; 32]).sign(canonical(&log["seal"]).as_bytes()).into();
        assert!(verify(&log).is_err(), "another key's signature must not pass");

        let other = Signer::from_seed([8; 32]);
        let mut log = sealed();
        log["seal"]["public_key"] = other.public_key().into();
        log["signature"] = other.sign(canonical(&log["seal"]).as_bytes()).into();
        assert!(verify(&log).is_ok(), "a whole log signed by another key is still internally sound");

        for breakage in [
            |l: &mut Value| l["seal"]["session_id"] = "s2".into(),
            |l: &mut Value| l["seal"]["sealed_at"] = 10.into(),
            |l: &mut Value| l["seal"]["final_hash"] = l["entries"][0]["hash"].clone(),
            |l: &mut Value| l["signature"] = "00".into(),
            |l: &mut Value| l["format"] = "other".into(),
        ] {
            let mut log = sealed();
            breakage(&mut log);
            assert!(verify(&log).is_err());
        }
    }

    #[test]
    fn a_write_s_content_stays_out_of_the_log() {
        let args = safe_args(&json!({ "path": "~/a.txt", "content": "secret contents", "base_hash": "ab" }));
        assert!(!canonical(&args).contains("secret contents"));
        assert_eq!(args["content_bytes"], 15);
        assert_eq!(args["content_hash"], sha256(b"secret contents"));
        assert_eq!(args["base_hash"], "ab");
        assert!(!safe_args(&json!({ "content": { "nested": "secret" } })).to_string().contains("secret"));
    }

    #[test]
    fn output_is_logged_as_a_size_and_a_hash() {
        let facts = output_facts("secret contents", true);
        assert_eq!(facts, json!({ "bytes": 15, "hash": sha256(b"secret contents"), "truncated": true }));
    }
}
