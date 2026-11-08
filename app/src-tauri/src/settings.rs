use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const FILE: &str = "settings.json";

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub auto_update: bool,
    pub keep_days: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { auto_update: true, keep_days: None }
    }
}

pub struct Prefs {
    dir: Option<PathBuf>,
    now: Mutex<Settings>,
}

impl Prefs {
    pub fn load(dir: Option<PathBuf>) -> Self {
        let now = dir
            .as_ref()
            .and_then(|d| std::fs::read_to_string(d.join(FILE)).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        Prefs { dir, now: Mutex::new(now) }
    }

    pub fn get(&self) -> Settings {
        *self.now.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn set(&self, s: Settings) -> Result<(), String> {
        if let Some(dir) = &self.dir {
            write(dir, &s)?;
        }
        *self.now.lock().unwrap_or_else(|e| e.into_inner()) = s;
        Ok(())
    }
}

fn write(dir: &Path, s: &Settings) -> Result<(), String> {
    let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(FILE), text + "\n").map_err(|e| format!("Couldn't save your settings: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_settings_across_launches_and_defaults_to_updating() {
        let dir = std::env::temp_dir().join(format!("valet-settings-{}", crate::types::now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(Prefs::load(Some(dir.clone())).get(), Settings::default());
        let s = Settings { auto_update: false, keep_days: Some(30) };
        Prefs::load(Some(dir.clone())).set(s).unwrap();
        assert_eq!(Prefs::load(Some(dir.clone())).get(), s);
        std::fs::write(dir.join(FILE), "{\"keepDays\": 7}").unwrap();
        assert_eq!(Prefs::load(Some(dir)).get(), Settings { auto_update: true, keep_days: Some(7) });
    }
}
