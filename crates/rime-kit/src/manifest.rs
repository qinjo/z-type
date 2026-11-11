//! `.rime-studio/state.json`：GUI 的托管键清单。
//!
//! 这是"哪些键归 GUI 所有"的唯一真相来源。不在清单里的键，无论文件里写了什么，
//! 都视为用户的，GUI 只读不改。

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::patch::{self, Edit};

pub const STATE_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct State {
    pub schema_version: u32,
    #[serde(default)]
    pub files: BTreeMap<String, FileOwnership>,
}

impl Default for State {
    fn default() -> Self {
        State {
            schema_version: STATE_SCHEMA_VERSION,
            files: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FileOwnership {
    /// 键 → 上次写入的记录。
    pub keys: BTreeMap<String, KeyRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeyRecord {
    /// 上次写入值的规范化 hash。
    pub hash: String,
    /// ISO8601 UTC 时间戳。
    pub written_at: String,
}

/// 漂移：用户手改过 GUI 拥有的键。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Drift {
    /// 键在文件里消失了（用户删了，或文件被整体替换）。
    Missing { key: String },
    /// 键还在，但值被用户改过。
    Modified {
        key: String,
        stored_hash: String,
        actual_hash: String,
    },
}

impl Drift {
    pub fn key(&self) -> &str {
        match self {
            Drift::Missing { key } => key,
            Drift::Modified { key, .. } => key,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StateError {
    #[error("读取状态文件失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("状态文件格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("状态文件版本 {found} 高于本程序支持的 {supported}，请升级 Rime Studio")]
    UnsupportedVersion { found: u32, supported: u32 },
}

impl State {
    /// 读取状态文件；文件不存在时返回默认状态（首次运行）。
    pub fn load(path: &Path) -> Result<Self, StateError> {
        match std::fs::read_to_string(path) {
            Ok(text) => {
                let state: State = serde_json::from_str(&text)?;
                if state.schema_version > STATE_SCHEMA_VERSION {
                    return Err(StateError::UnsupportedVersion {
                        found: state.schema_version,
                        supported: STATE_SCHEMA_VERSION,
                    });
                }
                Ok(state)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::default()),
            Err(e) => Err(StateError::Io(e)),
        }
    }

    /// 原子写入：临时文件 + rename。
    pub fn save(&self, path: &Path) -> Result<(), StateError> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn key_record(&self, file: &str, key: &str) -> Option<&KeyRecord> {
        self.files.get(file)?.keys.get(key)
    }

    pub fn owned_keys(&self, file: &str) -> Vec<&str> {
        self.files
            .get(file)
            .map(|f| f.keys.keys().map(String::as_str).collect())
            .unwrap_or_default()
    }

    /// 记录一次写入（值从写后的文件文本里解析出 hash）。
    pub fn record(&mut self, file: &str, key: &str, text_after: &str, written_at: &str) {
        if let Some(hash) = patch::current_hash(text_after, key) {
            self.files.entry(file.to_string()).or_default().keys.insert(
                key.to_string(),
                KeyRecord {
                    hash,
                    written_at: written_at.to_string(),
                },
            );
        }
    }

    pub fn forget(&mut self, file: &str, key: &str) {
        if let Some(f) = self.files.get_mut(file) {
            f.keys.remove(key);
            if f.keys.is_empty() {
                self.files.remove(file);
            }
        }
    }

    /// 按刚应用的 edits 更新清单（Set/SetRaw 记录，Remove 遗忘）。
    pub fn record_edits(&mut self, file: &str, text_after: &str, edits: &[Edit], written_at: &str) {
        for edit in edits {
            match edit {
                Edit::Remove { key } => self.forget(file, key),
                _ => self.record(file, edit.key(), text_after, written_at),
            }
        }
    }

    /// 写入前调用：找出被用户手改过的托管键。
    pub fn detect_drift(&self, file: &str, text: &str) -> Vec<Drift> {
        let Some(ownership) = self.files.get(file) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for (key, record) in &ownership.keys {
            match patch::current_hash(text, key) {
                None => out.push(Drift::Missing { key: key.clone() }),
                Some(actual) if actual != record.hash => out.push(Drift::Modified {
                    key: key.clone(),
                    stored_hash: record.hash.clone(),
                    actual_hash: actual,
                }),
                Some(_) => {}
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::{apply_edits, CreatePolicy, Edit};
    use serde_yaml::Value;

    const FILE: &str = "squirrel.custom.yaml";

    fn v(s: &str) -> Value {
        serde_yaml::from_str(s).unwrap()
    }

    #[test]
    fn record_then_detect_user_edit() {
        let mut state = State::default();
        let text = "patch:\n  style/font_point: 14\n";
        state.record(FILE, "style/font_point", text, "2026-11-11T00:00:00Z");
        assert!(state.detect_drift(FILE, text).is_empty());

        let user_edited = "patch:\n  style/font_point: 20\n";
        let drift = state.detect_drift(FILE, user_edited);
        assert_eq!(drift.len(), 1);
        assert!(matches!(&drift[0], Drift::Modified { key, .. } if key == "style/font_point"));

        let user_deleted = "patch:\n  style/font_face: X\n";
        let drift = state.detect_drift(FILE, user_deleted);
        assert!(matches!(&drift[0], Drift::Missing { key } if key == "style/font_point"));
    }

    #[test]
    fn unowned_keys_are_never_drift() {
        let state = State::default();
        assert!(state.detect_drift(FILE, "patch:\n  my/key: 1\n").is_empty());
    }

    #[test]
    fn record_edits_updates_and_forgets() {
        let mut state = State::default();
        let after = apply_edits(
            "patch:\n  style/font_point: 14\n",
            &[
                Edit::set("style/font_point", v("16")),
                Edit::set_raw("preset_color_schemes/x", "back_color: 0x112233"),
                Edit::remove("nonexistent"),
            ],
            CreatePolicy::Reject,
        )
        .unwrap();
        state.record_edits(
            FILE,
            &after,
            &[
                Edit::set("style/font_point", v("16")),
                Edit::set_raw("preset_color_schemes/x", "back_color: 0x112233"),
            ],
            "2026-11-11T00:00:00Z",
        );
        assert_eq!(state.owned_keys(FILE).len(), 2);
        state.forget(FILE, "style/font_point");
        assert_eq!(state.owned_keys(FILE), vec!["preset_color_schemes/x"]);
    }

    #[test]
    fn roundtrip_json() {
        let mut state = State::default();
        state.record(FILE, "a", "patch:\n  a: 1\n", "t");
        let json = serde_json::to_string(&state).unwrap();
        let back: State = serde_json::from_str(&json).unwrap();
        assert_eq!(back, state);
        assert_eq!(back.schema_version, STATE_SCHEMA_VERSION);
    }
}
