//! 用户目录工作区：把"快照 → 漂移检测 → 文本级写回 → 原子落盘 → 记账"编排成一个可测试的动作。
//!
//! 这是 GUI 唯一的写入口。Tauri 层只做参数反序列化，不做任何业务判断。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::manifest::{Drift, State};
use crate::patch::{apply_edits, CreatePolicy, Edit};
use crate::{snapshot, time};

pub const META_DIR: &str = ".qieyun";

#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("拒绝写入非 custom 文件或非法文件名：{0}")]
    InvalidFile(String),
    #[error("{file} 中的这些键被手动修改过，已中止写入：{keys}")]
    Drift { file: String, keys: String },
    #[error("备份失败，已中止写入：{0}")]
    Backup(String),
    #[error("处理 {file} 失败：{source}")]
    Patch {
        file: String,
        #[source]
        source: crate::patch::PatchError,
    },
    #[error("写入 {file} 失败：{source}")]
    Io {
        file: String,
        #[source]
        source: std::io::Error,
    },
    #[error("状态文件错误：{0}")]
    State(String),
}

impl WriteError {
    /// 供 UI 判断是否需要进入冲突解决页。
    pub fn drift_keys(&self) -> Option<(&str, Vec<&str>)> {
        match self {
            WriteError::Drift { file, keys } => {
                Some((file, keys.split('、').filter(|s| !s.is_empty()).collect()))
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOutcome {
    pub written_files: Vec<String>,
    pub snapshot_id: Option<String>,
}

/// 用户在磁盘上的 Rime 配置目录。
#[derive(Debug, Clone)]
pub struct Workspace {
    pub user_dir: PathBuf,
}

impl Workspace {
    pub fn new(user_dir: impl Into<PathBuf>) -> Self {
        Workspace {
            user_dir: user_dir.into(),
        }
    }

    pub fn meta_dir(&self) -> PathBuf {
        self.user_dir.join(META_DIR)
    }

    pub fn state_path(&self) -> PathBuf {
        self.meta_dir().join("state.json")
    }

    pub fn snapshots_dir(&self) -> PathBuf {
        self.meta_dir().join("snapshots")
    }

    /// 校验目标文件名：只允许 `*.custom.yaml`，不允许路径分隔符。
    pub fn custom_file(&self, name: &str) -> Result<PathBuf, WriteError> {
        let bad = !name.ends_with(".custom.yaml")
            || name.contains('/')
            || name.contains('\\')
            || name.contains("..");
        if bad {
            return Err(WriteError::InvalidFile(name.to_string()));
        }
        Ok(self.user_dir.join(name))
    }

    pub fn drift_for(&self, file: &str, state: &State) -> Vec<Drift> {
        let text = std::fs::read_to_string(self.user_dir.join(file)).unwrap_or_default();
        state.detect_drift(file, &text)
    }

    /// 应用一批写入意图。所有文件先全部通过校验，再统一落盘（避免写一半）。
    pub fn write_patch(
        &self,
        files: &BTreeMap<String, Vec<Edit>>,
        note: Option<&str>,
    ) -> Result<WriteOutcome, WriteError> {
        if files.is_empty() {
            return Ok(WriteOutcome {
                written_files: Vec::new(),
                snapshot_id: None,
            });
        }
        self.ensure_dirs()?;

        // 1) 写前快照
        let mut snapshot_id = None;
        if self.user_dir.is_dir() {
            let label = note.unwrap_or("GUI 修改前自动备份");
            let info = snapshot::create(&self.user_dir, &self.snapshots_dir(), label)
                .map_err(|e| WriteError::Backup(e.to_string()))?;
            snapshot_id = Some(info.id);
        }

        let mut state =
            State::load(&self.state_path()).map_err(|e| WriteError::State(e.to_string()))?;
        let now = time::format_iso8601_utc(time::now_unix());

        struct Pending {
            name: String,
            path: PathBuf,
            before: String,
            after: String,
            edits: Vec<Edit>,
        }
        let mut pending = Vec::new();

        for (name, edits) in files {
            let path = self.custom_file(name)?;
            let before = std::fs::read_to_string(&path).unwrap_or_default();

            let drift = state.detect_drift(name, &before);
            if !drift.is_empty() {
                return Err(WriteError::Drift {
                    file: name.clone(),
                    keys: drift.iter().map(|d| d.key()).collect::<Vec<_>>().join("、"),
                });
            }

            let after = apply_edits(&before, edits, CreatePolicy::Create).map_err(|e| {
                WriteError::Patch {
                    file: name.clone(),
                    source: e,
                }
            })?;
            pending.push(Pending {
                name: name.clone(),
                path,
                before,
                after,
                edits: edits.clone(),
            });
        }

        // 2) 落盘 + 记账
        let mut written = Vec::new();
        for item in &pending {
            if item.after != item.before {
                atomic_write(&item.path, &item.after).map_err(|e| WriteError::Io {
                    file: item.name.clone(),
                    source: e,
                })?;
            }
            state.record_edits(&item.name, &item.after, &item.edits, &now);
            written.push(item.name.clone());
        }
        state
            .save(&self.state_path())
            .map_err(|e| WriteError::State(e.to_string()))?;

        Ok(WriteOutcome {
            written_files: written,
            snapshot_id,
        })
    }

    fn ensure_dirs(&self) -> Result<(), WriteError> {
        std::fs::create_dir_all(self.snapshots_dir()).map_err(|e| WriteError::Io {
            file: META_DIR.to_string(),
            source: e,
        })
    }
}

/// 原子写入：临时文件 + rename（同目录）。
fn atomic_write(path: &Path, content: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp.qieyun");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::Value;

    fn ws(tag: &str) -> Workspace {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "qieyun-ws-{tag}-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Workspace::new(dir)
    }

    fn files(pairs: &[(&str, Vec<Edit>)]) -> BTreeMap<String, Vec<Edit>> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.clone()))
            .collect()
    }

    #[test]
    fn writes_creates_state_and_snapshot() {
        let w = ws("basic");
        std::fs::write(
            w.user_dir.join("squirrel.custom.yaml"),
            "patch:\n  a: 1\n# 用户注释\n",
        )
        .unwrap();

        let out = w
            .write_patch(
                &files(&[(
                    "squirrel.custom.yaml",
                    vec![Edit::set("style/font_point", Value::from(14u64))],
                )]),
                Some("测试写入"),
            )
            .unwrap();

        assert_eq!(out.written_files, vec!["squirrel.custom.yaml"]);
        assert!(out.snapshot_id.is_some());
        let text = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        assert!(text.contains("# 用户注释"), "注释必须保留");
        assert!(text.contains("style/font_point: 14"));

        let state = State::load(&w.state_path()).unwrap();
        assert_eq!(
            state.owned_keys("squirrel.custom.yaml"),
            vec!["style/font_point"]
        );
        assert!(w.snapshots_dir().is_dir());
    }

    #[test]
    fn aborts_on_drift_without_writing() {
        let w = ws("drift");
        let path = w.user_dir.join("squirrel.custom.yaml");
        std::fs::write(&path, "patch:\n  style/font_point: 14\n").unwrap();

        // 第一次写入建立托管记录
        w.write_patch(
            &files(&[(
                "squirrel.custom.yaml",
                vec![Edit::set("style/font_point", Value::from(14u64))],
            )]),
            None,
        )
        .unwrap();
        // 用户手改
        std::fs::write(&path, "patch:\n  style/font_point: 20\n").unwrap();

        let err = w
            .write_patch(
                &files(&[(
                    "squirrel.custom.yaml",
                    vec![Edit::set("style/font_point", Value::from(16u64))],
                )]),
                None,
            )
            .unwrap_err();

        assert!(matches!(err, WriteError::Drift { .. }));
        assert_eq!(
            err.drift_keys(),
            Some(("squirrel.custom.yaml", vec!["style/font_point"]))
        );
        // 文件未被改动
        assert!(std::fs::read_to_string(&path).unwrap().contains("20"));
    }

    #[test]
    fn rejects_illegal_targets() {
        let w = ws("illegal");
        for name in ["default.yaml", "../x.custom.yaml", "dir/x.custom.yaml"] {
            let err = w.write_patch(
                &files(&[(name, vec![Edit::set("a", Value::from(1u64))])]),
                None,
            );
            assert!(matches!(err, Err(WriteError::InvalidFile(_))), "{name}");
        }
    }

    #[test]
    fn idempotent_across_runs() {
        let w = ws("idem");
        let edits = vec![
            Edit::set("style/font_point", Value::from(14u64)),
            Edit::set_raw("preset_color_schemes/x", "back_color: 0x112233"),
        ];
        w.write_patch(&files(&[("squirrel.custom.yaml", edits.clone())]), None)
            .unwrap();
        let first = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        // 第二次：值不变，不应产生任何写入
        let out = w
            .write_patch(&files(&[("squirrel.custom.yaml", edits)]), None)
            .unwrap();
        let second = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        assert_eq!(first, second);
        assert_eq!(out.written_files.len(), 1);
    }
}
