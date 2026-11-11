//! 快照与回滚：写入前把配置类文件整包复制到 `.qieyun-studio/snapshots/<stamp>/`。
//!
//! 只备份配置，不备份 `build/`、`*.userdb`（LevelDB）、`plum/` 等可重建或体积大的内容。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::time;

/// 参与快照的扩展名。
pub const CONFIG_EXTENSIONS: &[&str] = &["yaml", "yml", "txt", "json"];
/// 不进入快照的目录名（Rime 用户目录下常见）。
pub const EXCLUDED_DIRS: &[&str] = &["build", "plum", "sync", "userdb", ".git", "node_modules"];
/// 默认保留的快照份数。
pub const DEFAULT_KEEP: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SnapshotInfo {
    pub id: String,
    pub created_at: String,
    pub note: String,
    pub file_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Meta {
    id: String,
    created_at: String,
    note: String,
    files: Vec<String>,
}

pub fn is_config_file(path: &Path) -> bool {
    if path.file_name().is_some_and(|n| n == "meta.json") {
        return false;
    }
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| CONFIG_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)))
            .unwrap_or(false)
}

/// 收集 Rime 用户目录根层的配置文件名（非递归，按名字排序）。
pub fn collect_config_files(rime_dir: &Path) -> io::Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(rime_dir)? {
        let path = entry?.path();
        if path.is_dir() {
            continue;
        }
        if is_config_file(&path) {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// 创建快照，返回信息。`note` 可为空。
pub fn create(rime_dir: &Path, store_dir: &Path, note: &str) -> io::Result<SnapshotInfo> {
    if !rime_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Rime 用户目录不存在：{}", rime_dir.display()),
        ));
    }
    let created_at = time::format_iso8601_utc(time::now_unix());
    let mut id = created_at.replace(':', "-");
    let mut n = 1;
    while store_dir.join(&id).exists() {
        id = format!("{}-{n}", created_at.replace(':', "-"));
        n += 1;
    }

    let dest = store_dir.join(&id);
    fs::create_dir_all(&dest)?;

    let mut files = Vec::new();
    for src in collect_config_files(rime_dir)? {
        let name = src.file_name().unwrap().to_string_lossy().to_string();
        fs::copy(&src, dest.join(&name))?;
        files.push(name);
    }

    let meta = Meta {
        id: id.clone(),
        created_at: created_at.clone(),
        note: note.to_string(),
        files: files.clone(),
    };
    fs::write(dest.join("meta.json"), serde_json::to_string_pretty(&meta)?)?;

    Ok(SnapshotInfo {
        id,
        created_at,
        note: note.to_string(),
        file_count: files.len(),
    })
}

/// 列出快照（新的在前）。
pub fn list(store_dir: &Path) -> io::Result<Vec<SnapshotInfo>> {
    let mut out = Vec::new();
    if !store_dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(store_dir)? {
        let path = entry?.path();
        if !path.is_dir() {
            continue;
        }
        let meta_path = path.join("meta.json");
        if let Ok(text) = fs::read_to_string(&meta_path) {
            if let Ok(meta) = serde_json::from_str::<Meta>(&text) {
                out.push(SnapshotInfo {
                    id: meta.id,
                    created_at: meta.created_at,
                    note: meta.note,
                    file_count: meta.files.len(),
                });
                continue;
            }
        }
        // meta 缺失/损坏时用目录名兜底
        out.push(SnapshotInfo {
            id: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string(),
            created_at: String::new(),
            note: String::new(),
            file_count: 0,
        });
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

/// 把快照内容恢复回 Rime 用户目录，返回恢复的文件数。
pub fn restore(snapshot_dir: &Path, rime_dir: &Path) -> io::Result<usize> {
    if !snapshot_dir.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("快照不存在：{}", snapshot_dir.display()),
        ));
    }
    fs::create_dir_all(rime_dir)?;
    let mut count = 0;
    for entry in fs::read_dir(snapshot_dir)? {
        let path = entry?.path();
        if !is_config_file(&path) {
            continue;
        }
        let name = path.file_name().unwrap();
        fs::copy(&path, rime_dir.join(name))?;
        count += 1;
    }
    Ok(count)
}

/// 只保留最近 `keep` 份快照，返回删除数量。
pub fn prune(store_dir: &Path, keep: usize) -> io::Result<usize> {
    let items = list(store_dir)?;
    let mut removed = 0;
    for info in items.into_iter().skip(keep) {
        let path = store_dir.join(&info.id);
        if path.is_dir() {
            fs::remove_dir_all(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-kit-snap-{tag}-{}-{}",
            std::process::id(),
            time::now_unix()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_list_restore_prune() {
        let root = tmpdir("root");
        let rime = root.join("rime");
        let store = root.join("store");
        fs::create_dir_all(rime.join("build")).unwrap();
        fs::write(rime.join("default.custom.yaml"), "patch:\n  a: 1\n").unwrap();
        fs::write(rime.join("note.txt"), "x").unwrap();
        fs::write(rime.join("build/ignored.yaml"), "should not be copied").unwrap();
        fs::write(rime.join("rime_ice.userdb"), "binary").unwrap();

        let info = create(&rime, &store, "首次").unwrap();
        assert_eq!(info.file_count, 2);
        let listed = list(&store).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].note, "首次");

        // 改动后恢复
        fs::write(rime.join("default.custom.yaml"), "patch:\n  a: 2\n").unwrap();
        let n = restore(&store.join(&info.id), &rime).unwrap();
        assert_eq!(n, 2);
        let restored = fs::read_to_string(rime.join("default.custom.yaml")).unwrap();
        assert!(restored.contains("a: 1"));

        let second = create(&rime, &store, "二次").unwrap();
        assert_ne!(second.id, info.id);
        assert_eq!(list(&store).unwrap().len(), 2);
        assert_eq!(prune(&store, 1).unwrap(), 1);
        assert_eq!(list(&store).unwrap().len(), 1);
    }

    #[test]
    fn only_config_extensions_are_snapshotted() {
        let root = tmpdir("ext");
        let rime = root.join("rime");
        fs::create_dir_all(&rime).unwrap();
        fs::write(rime.join("a.yaml"), "").unwrap();
        fs::write(rime.join("b.bin"), "").unwrap();
        assert!(is_config_file(&rime.join("a.yaml")));
        assert!(!is_config_file(&rime.join("b.bin")));
    }
}
