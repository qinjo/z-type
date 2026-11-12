//! 词典与用户词库盘点（只读）。
//!
//! 说明：`*.userdb` 是 LevelDB，读写需要 librime 的 user_dict API（尚未接入 FFI）。
//! 所以 V1 只做盘点：文件在哪、多大、同步目录配了没——已经能回答"我的词库到底在哪"。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DictScope {
    User,
    Shared,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DictFile {
    pub name: String,
    pub scope: DictScope,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserDb {
    pub name: String,
    /// 目录总大小（LevelDB 是目录）。
    pub size_bytes: u64,
    /// 是否是 legacy 的 `*.userdb.txt` 文本词库。
    pub legacy_text: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DictInventory {
    pub dicts: Vec<DictFile>,
    pub userdbs: Vec<UserDb>,
    pub sync_dir: Option<String>,
    /// `build/` 里的编译产物数量（`.bin` + `.schema.yaml`）。
    pub build_artifacts: usize,
}

pub fn inventory(user_dir: &Path, shared_dir: Option<&Path>) -> DictInventory {
    let mut out = DictInventory::default();

    for (dir, scope) in std::iter::once((user_dir, DictScope::User))
        .chain(shared_dir.map(|d| (d, DictScope::Shared)))
    {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".dict.yaml") {
                continue;
            }
            out.dicts.push(DictFile {
                name,
                scope,
                size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            });
        }
    }
    out.dicts.sort_by(|a, b| a.name.cmp(&b.name));

    // LevelDB 用户词库是目录，legacy 的是 *.userdb.txt
    if let Ok(entries) = std::fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".userdb") && path.is_dir() {
                out.userdbs.push(UserDb {
                    name,
                    size_bytes: dir_size(&path),
                    legacy_text: false,
                });
            } else if name.ends_with(".userdb.txt") && path.is_file() {
                out.userdbs.push(UserDb {
                    name,
                    size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
                    legacy_text: true,
                });
            }
        }
    }
    out.userdbs.sort_by(|a, b| a.name.cmp(&b.name));

    out.sync_dir = crate::env::read_installation(user_dir).and_then(|m| m.sync_dir);

    let build = user_dir.join("build");
    if let Ok(entries) = std::fs::read_dir(&build) {
        out.build_artifacts = entries
            .flatten()
            .filter(|e| {
                let n = e.file_name().to_string_lossy().to_string();
                n.ends_with(".bin") || n.ends_with(".schema.yaml")
            })
            .count();
    }

    out
}

fn dir_size(dir: &Path) -> u64 {
    let mut total = 0;
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            total += dir_size(&path);
        } else {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

pub fn user_dir_of(path: &Path) -> PathBuf {
    path.to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-dicts-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn inventories_dicts_userdb_and_build() {
        let root = tmp("inv");
        let user = root.join("user");
        let shared = root.join("shared");
        std::fs::create_dir_all(user.join("build")).unwrap();
        std::fs::create_dir_all(user.join("rime_ice.userdb")).unwrap();
        std::fs::create_dir_all(&shared).unwrap();

        std::fs::write(user.join("rime_ice.dict.yaml"), "x".repeat(100)).unwrap();
        std::fs::write(shared.join("luna_pinyin.dict.yaml"), "y".repeat(50)).unwrap();
        std::fs::write(user.join("rime_ice.userdb/000001.ldb"), "z".repeat(30)).unwrap();
        std::fs::write(user.join("rime_ice.userdb/CURRENT"), "M").unwrap();
        std::fs::write(user.join("build/rime_ice.schema.yaml"), "a").unwrap();
        std::fs::write(user.join("build/rime_ice.prism.bin"), "b").unwrap();
        std::fs::write(user.join("build/notes.txt"), "c").unwrap();
        std::fs::write(
            user.join("installation.yaml"),
            "sync_dir: \"/tmp/rime-sync\"\n",
        )
        .unwrap();

        let inv = inventory(&user, Some(&shared));
        assert_eq!(inv.dicts.len(), 2);
        assert_eq!(inv.dicts[0].name, "luna_pinyin.dict.yaml");
        assert_eq!(inv.dicts[0].scope, DictScope::Shared);
        assert_eq!(inv.dicts[1].size_bytes, 100);
        assert_eq!(inv.userdbs.len(), 1);
        assert_eq!(inv.userdbs[0].size_bytes, 31);
        assert!(!inv.userdbs[0].legacy_text);
        assert_eq!(inv.build_artifacts, 2);
        assert_eq!(inv.sync_dir.as_deref(), Some("/tmp/rime-sync"));
    }

    #[test]
    fn empty_profile_is_fine() {
        let root = tmp("empty");
        let inv = inventory(&root, None);
        assert!(inv.dicts.is_empty());
        assert!(inv.userdbs.is_empty());
        assert_eq!(inv.build_artifacts, 0);
    }
}
