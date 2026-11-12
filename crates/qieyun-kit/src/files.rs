//! 用户目录文件清单（高级页用）。

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    /// `*.custom.yaml`（GUI 的主战场）
    Custom,
    /// `default.yaml` 等普通配置
    Config,
    /// `*.schema.yaml`
    Schema,
    /// `*.dict.yaml`（通常很大，只读）
    Dict,
    /// installation.yaml / user.yaml
    Installation,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserFile {
    pub name: String,
    pub size_bytes: u64,
    /// ISO8601 UTC；读不到 mtime 时为 None。
    pub modified: Option<String>,
    pub kind: FileKind,
    /// 是否允许在高级页编辑（dict / build 产物不允许）。
    pub editable: bool,
}

pub fn list(user_dir: &Path) -> Vec<UserFile> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(user_dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !(lower.ends_with(".yaml") || lower.ends_with(".yml") || lower.ends_with(".txt")) {
            continue;
        }

        let kind = if name.ends_with(".custom.yaml") {
            FileKind::Custom
        } else if name.ends_with(".dict.yaml") {
            FileKind::Dict
        } else if name.ends_with(".schema.yaml") {
            FileKind::Schema
        } else if name == "installation.yaml" || name == "user.yaml" {
            FileKind::Installation
        } else if name == "default.yaml" {
            FileKind::Config
        } else {
            FileKind::Other
        };

        let editable = matches!(
            kind,
            FileKind::Custom | FileKind::Config | FileKind::Schema | FileKind::Other
        ) && !lower.ends_with(".dict.yaml");

        let meta = entry.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| crate::time::format_iso8601_utc(d.as_secs()));

        out.push(UserFile {
            name,
            size_bytes: meta.map(|m| m.len()).unwrap_or(0),
            modified,
            kind,
            editable,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-files-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_and_classifies_files() {
        let dir = tmp("list");
        std::fs::write(dir.join("default.yaml"), "a").unwrap();
        std::fs::write(dir.join("default.custom.yaml"), "b").unwrap();
        std::fs::write(dir.join("rime_ice.schema.yaml"), "c").unwrap();
        std::fs::write(dir.join("rime_ice.dict.yaml"), "d").unwrap();
        std::fs::write(dir.join("installation.yaml"), "e").unwrap();
        std::fs::write(dir.join("notes.md"), "f").unwrap();
        std::fs::create_dir_all(dir.join("build")).unwrap();

        let files = list(&dir);
        assert_eq!(files.len(), 5, "{files:?}");
        assert!(!files.iter().any(|f| f.name == "notes.md"));
        assert!(!files.iter().any(|f| f.name == "build"));

        let dict = files
            .iter()
            .find(|f| f.name == "rime_ice.dict.yaml")
            .unwrap();
        assert_eq!(dict.kind, FileKind::Dict);
        assert!(!dict.editable, "词典文件不允许编辑");

        let custom = files
            .iter()
            .find(|f| f.name == "default.custom.yaml")
            .unwrap();
        assert_eq!(custom.kind, FileKind::Custom);
        assert!(custom.editable);
        assert!(custom.modified.is_some());

        let schema = files
            .iter()
            .find(|f| f.name == "rime_ice.schema.yaml")
            .unwrap();
        assert_eq!(schema.kind, FileKind::Schema);
        assert!(schema.editable);
    }

    #[test]
    fn missing_dir_returns_empty() {
        assert!(list(Path::new("/nonexistent/qieyun-files")).is_empty());
    }
}
