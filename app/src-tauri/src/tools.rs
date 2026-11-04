use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::needs::{resolve, tilde};

const HASH_LIMIT: u64 = 64 * 1024 * 1024;
const READ_DEFAULT: u64 = 256 * 1024;
const READ_MAX: u64 = 900 * 1024;
const TAIL_BYTES: u64 = 1024 * 1024;
const MAX_ENTRIES: usize = 2000;

pub enum Failure {
    Rejected(String),
    Failed(String),
}

type Outcome = Result<Value, Failure>;

pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn empty_hash() -> String {
    sha256(b"")
}

fn io(e: std::io::Error) -> Failure {
    Failure::Failed(e.to_string())
}

fn still_at(raw: &str, resolved: &Path) -> Result<(), Failure> {
    match resolve(raw) {
        Ok(p) if p == resolved => Ok(()),
        _ => Err(Failure::Rejected(format!("{raw} moved or changed what it points to while waiting. Send the request again."))),
    }
}

pub fn file_hash(p: &Path) -> Result<String, Failure> {
    let meta = match std::fs::metadata(p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(empty_hash()),
        Err(e) => return Err(io(e)),
    };
    if meta.len() > HASH_LIMIT {
        return Err(Failure::Failed(format!("{} is larger than 64 MB.", tilde(p))));
    }
    Ok(sha256(&std::fs::read(p).map_err(io)?))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

pub fn read_file(raw: &str, p: &Path, max_bytes: Option<u64>) -> Outcome {
    still_at(raw, p)?;
    let hash = file_hash(p)?;
    let limit = max_bytes.unwrap_or(READ_DEFAULT).min(READ_MAX);
    let mut buf = Vec::new();
    let f = std::fs::File::open(p).map_err(io)?;
    let len = f.metadata().map_err(io)?.len();
    f.take(limit).read_to_end(&mut buf).map_err(io)?;
    Ok(json!({ "content": text(&buf), "hash": hash, "truncated": len > limit }))
}

pub fn tail_log(raw: &str, p: &Path, lines: Option<usize>) -> Outcome {
    still_at(raw, p)?;
    let hash = file_hash(p)?;
    let lines = lines.unwrap_or(200).clamp(1, 5000);
    let mut f = std::fs::File::open(p).map_err(io)?;
    let len = f.metadata().map_err(io)?.len();
    let start = len.saturating_sub(TAIL_BYTES);
    f.seek(SeekFrom::Start(start)).map_err(io)?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(io)?;
    let all = text(&buf);
    let kept: Vec<&str> = all.lines().rev().take(lines).collect();
    let content = kept.into_iter().rev().collect::<Vec<_>>().join("\n");
    Ok(json!({ "content": content, "hash": hash }))
}

pub fn write_file(raw: &str, p: &Path, content: &str, base_hash: &str) -> Outcome {
    still_at(raw, p)?;
    if file_hash(p)? != base_hash {
        return Err(Failure::Rejected(format!("{raw} changed after it was last read. Read it again first.")));
    }
    let dir = p.parent().ok_or_else(|| Failure::Failed("The file has no folder.".into()))?;
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = dir.join(format!(".{name}.valet-{}", std::process::id()));
    let result = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
        if let Ok(meta) = std::fs::metadata(p) {
            f.set_permissions(meta.permissions())?;
        }
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, p)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(io(e));
    }
    Ok(json!({ "hash": sha256(content.as_bytes()), "bytes": content.len() }))
}

pub fn list_dir(raw: &str, p: &Path) -> Outcome {
    still_at(raw, p)?;
    let mut entries: Vec<Value> = Vec::new();
    let mut names: Vec<_> = std::fs::read_dir(p).map_err(io)?.filter_map(Result::ok).collect();
    names.sort_by_key(|e| e.file_name());
    let truncated = names.len() > MAX_ENTRIES;
    for e in names.into_iter().take(MAX_ENTRIES) {
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        let kind = if meta.is_symlink() {
            "link"
        } else if meta.is_dir() {
            "dir"
        } else if meta.is_file() {
            "file"
        } else {
            "other"
        };
        entries.push(json!({ "name": e.file_name().to_string_lossy(), "type": kind, "size": if meta.is_file() { meta.len() } else { 0 } }));
    }
    Ok(json!({ "entries": entries, "truncated": truncated }))
}

pub fn list_processes() -> Outcome {
    let out = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,comm="])
        .env_clear()
        .output()
        .map_err(io)?;
    let processes: Vec<Value> = text(&out.stdout)
        .lines()
        .filter_map(|l| {
            let l = l.trim_start();
            let (pid, comm) = l.split_once(' ')?;
            let name = comm.trim().rsplit('/').next().unwrap_or(comm).to_string();
            Some(json!({ "pid": pid.parse::<u32>().ok()?, "name": name }))
        })
        .take(MAX_ENTRIES)
        .collect();
    Ok(json!({ "processes": processes }))
}

pub fn diff(old: &str, new: &str) -> Vec<String> {
    let d = similar::TextDiff::from_lines(old, new);
    let mut out = Vec::new();
    for group in d.grouped_ops(3) {
        for op in group {
            for change in d.iter_changes(&op) {
                let sign = match change.tag() {
                    similar::ChangeTag::Delete => '-',
                    similar::ChangeTag::Insert => '+',
                    similar::ChangeTag::Equal => ' ',
                };
                out.push(format!("{sign}{}", change.value().trim_end_matches('\n')));
                if out.len() >= 400 {
                    return out;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("valet-tools-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn write_needs_the_hash_of_the_version_read() {
        let dir = temp("write");
        let p = dir.join("a.txt");
        let raw = p.display().to_string();
        assert!(write_file(&raw, &p, "one\n", &empty_hash()).is_ok());
        assert!(matches!(write_file(&raw, &p, "two\n", &empty_hash()), Err(Failure::Rejected(_))));
        let read = read_file(&raw, &p, None).ok().unwrap();
        assert!(write_file(&raw, &p, "two\n", read["hash"].as_str().unwrap()).is_ok());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two\n");
    }

    #[test]
    fn tail_keeps_the_last_lines() {
        let dir = temp("tail");
        let p = dir.join("x.log");
        std::fs::write(&p, "a\nb\nc\nd\n").unwrap();
        let out = tail_log(&p.display().to_string(), &p, Some(2)).ok().unwrap();
        assert_eq!(out["content"], "c\nd");
    }

    #[test]
    fn diff_marks_changed_lines() {
        assert_eq!(diff("a\nb\n", "a\nc\n"), vec![" a", "-b", "+c"]);
    }
}
