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

// ---------------------------------------------------------------------------
// 高级页：原始文件写入 / 危险操作
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawWrite {
    pub snapshot_id: Option<String>,
    pub bytes: usize,
}

impl Workspace {
    /// 校验原始编辑目标：只允许用户目录根层的 `.yaml/.yml/.txt`，且不允许词典文件。
    pub fn raw_editable_file(&self, name: &str) -> Result<PathBuf, WriteError> {
        let lower = name.to_lowercase();
        let bad = name.contains('/')
            || name.contains('\\')
            || name.contains("..")
            || !(lower.ends_with(".yaml") || lower.ends_with(".yml") || lower.ends_with(".txt"))
            || lower.ends_with(".dict.yaml");
        if bad {
            return Err(WriteError::InvalidFile(name.to_string()));
        }
        Ok(self.user_dir.join(name))
    }

    /// 高级页的原始写入：先校验 YAML 合法，再快照、原子落盘。
    ///
    /// 注意：原始编辑**不会**更新托管键清单——这正是设计意图：
    /// 用户绕开 GUI 手改后，下一次结构化写入会触发漂移检测并要求确认。
    pub fn write_raw(
        &self,
        name: &str,
        content: &str,
        note: Option<&str>,
    ) -> Result<RawWrite, WriteError> {
        let path = self.raw_editable_file(name)?;
        let is_yaml =
            name.to_lowercase().ends_with(".yaml") || name.to_lowercase().ends_with(".yml");
        if is_yaml && !content.trim().is_empty() {
            serde_yaml::from_str::<serde_yaml::Value>(content).map_err(|e| WriteError::Patch {
                file: name.to_string(),
                source: crate::patch::PatchError::Parse(e.to_string()),
            })?;
        }

        let snapshot_id = if self.user_dir.is_dir() {
            self.ensure_dirs()?;
            Some(
                crate::snapshot::create(
                    &self.user_dir,
                    &self.snapshots_dir(),
                    note.unwrap_or("原始文件编辑前自动备份"),
                )
                .map_err(|e| WriteError::Backup(e.to_string()))?
                .id,
            )
        } else {
            None
        };

        atomic_write(&path, content).map_err(|source| WriteError::Io {
            file: name.to_string(),
            source,
        })?;
        Ok(RawWrite {
            snapshot_id,
            bytes: content.len(),
        })
    }

    /// 危险操作：清空托管键清单（不动任何配置文件）。
    pub fn reset_managed_keys(&self) -> bool {
        std::fs::remove_file(self.state_path()).is_ok()
    }

    /// 危险操作：清理残留的部署锁。
    pub fn clear_deploy_lock(&self) -> bool {
        std::fs::remove_file(self.meta_dir().join("deploy.lock")).is_ok()
    }
}

// ---------------------------------------------------------------------------
// 首启接管与主题应用
// ---------------------------------------------------------------------------

impl Workspace {
    /// 是否已经接管过（state.json 存在即视为已接管）。
    pub fn is_taken_over(&self) -> bool {
        self.state_path().is_file()
    }

    /// 首启接管：先整包备份，再建立空的托管键清单。
    ///
    /// 不做任何配置写入——接管只是"声明所有权 + 留退路"。
    pub fn takeover(&self, note: &str) -> Result<crate::snapshot::SnapshotInfo, WriteError> {
        if !self.user_dir.is_dir() {
            return Err(WriteError::Io {
                file: self.user_dir.display().to_string(),
                source: std::io::Error::new(std::io::ErrorKind::NotFound, "Rime 用户目录不存在"),
            });
        }
        self.ensure_dirs()?;
        let info = crate::snapshot::create(&self.user_dir, &self.snapshots_dir(), note)
            .map_err(|e| WriteError::Backup(e.to_string()))?;
        // 建立清单（空 keys），表示"已接管但还没托管任何键"
        let state = State::default();
        state
            .save(&self.state_path())
            .map_err(|e| WriteError::State(e.to_string()))?;
        Ok(info)
    }

    /// 把一套主题编译并写入目标平台的样式文件。
    ///
    /// 注意：样式文件**不会**被 `rime_deployer` 编译进 `build/`，它由外壳在运行时读取，
    /// 因此写完之后还需要重载外壳（见 ADR-0008）。
    pub fn apply_theme(
        &self,
        theme: &crate::theme::Theme,
        platform: crate::platform::Platform,
        note: Option<&str>,
    ) -> Result<WriteOutcome, WriteError> {
        let file = match platform {
            crate::platform::Platform::Macos => "squirrel.custom.yaml",
            crate::platform::Platform::Windows => "weasel.custom.yaml",
        };
        let edits = theme.edits(platform);
        let mut files = BTreeMap::new();
        files.insert(file.to_string(), edits);
        self.write_patch(&files, note)
    }
}

#[cfg(test)]
mod takeover_tests {
    use super::*;
    use crate::platform::Platform;
    use crate::theme::Theme;

    fn ws(tag: &str) -> Workspace {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-takeover-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Workspace::new(dir)
    }

    #[test]
    fn takeover_creates_backup_and_marks_state() {
        let w = ws("take");
        std::fs::write(w.user_dir.join("default.custom.yaml"), "patch:\n  a: 1\n").unwrap();
        assert!(!w.is_taken_over());

        let snap = w.takeover("首次接管").unwrap();
        assert!(w.is_taken_over());
        assert!(w.snapshots_dir().join(&snap.id).is_dir());
        // 接管不写任何用户配置
        assert_eq!(
            std::fs::read_to_string(w.user_dir.join("default.custom.yaml")).unwrap(),
            "patch:\n  a: 1\n"
        );
    }

    #[test]
    fn takeover_requires_existing_user_dir() {
        let w = Workspace::new("/nonexistent/qieyun-takeover");
        assert!(w.takeover("x").is_err());
    }

    #[test]
    fn apply_theme_writes_platform_style_file() {
        let w = ws("theme");
        let theme = &Theme::presets()[0];
        let out = w.apply_theme(theme, Platform::Macos, None).unwrap();
        assert_eq!(out.written_files, vec!["squirrel.custom.yaml"]);
        let text = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        assert!(text.contains("style/color_scheme: qieyun_dark"));
        assert!(text.contains("back_color: 0xFF1E1E1E"));

        // Windows 目标写另一个文件
        let out = w.apply_theme(theme, Platform::Windows, None).unwrap();
        assert_eq!(out.written_files, vec!["weasel.custom.yaml"]);
    }

    #[test]
    fn applying_same_theme_twice_is_stable() {
        let w = ws("theme-idem");
        let theme = &Theme::presets()[0];
        w.apply_theme(theme, Platform::Macos, None).unwrap();
        let first = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        w.apply_theme(theme, Platform::Macos, None).unwrap();
        let second = std::fs::read_to_string(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        assert_eq!(first, second);
    }
}

#[cfg(test)]
mod raw_edit_tests {
    use super::*;

    fn ws(tag: &str) -> Workspace {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-raw-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Workspace::new(dir)
    }

    #[test]
    fn raw_write_validates_yaml_and_backs_up() {
        let w = ws("ok");
        std::fs::write(w.user_dir.join("default.custom.yaml"), "patch:\n  a: 1\n").unwrap();

        let out = w
            .write_raw("default.custom.yaml", "patch:\n  a: 2\n", Some("手改"))
            .unwrap();
        assert!(out.snapshot_id.is_some());
        assert_eq!(
            std::fs::read_to_string(w.user_dir.join("default.custom.yaml")).unwrap(),
            "patch:\n  a: 2\n"
        );

        // 坏 YAML 必须被拒绝，且不落盘
        let err = w
            .write_raw("default.custom.yaml", "patch: [\n", None)
            .unwrap_err();
        assert!(matches!(err, WriteError::Patch { .. }));
        assert_eq!(
            std::fs::read_to_string(w.user_dir.join("default.custom.yaml")).unwrap(),
            "patch:\n  a: 2\n"
        );
    }

    #[test]
    fn raw_write_rejects_dict_and_paths() {
        let w = ws("bad");
        for name in ["rime_ice.dict.yaml", "../evil.yaml", "sub/x.yaml", "a.bin"] {
            assert!(
                matches!(w.raw_editable_file(name), Err(WriteError::InvalidFile(_))),
                "{name} 应被拒绝"
            );
        }
        assert!(w.raw_editable_file("rime_ice.custom.yaml").is_ok());
        assert!(w.raw_editable_file("notes.txt").is_ok());
    }

    #[test]
    fn dangerous_operations_are_idempotent() {
        let w = ws("danger");
        let state = State::default();
        state.save(&w.state_path()).unwrap();
        std::fs::create_dir_all(w.meta_dir()).unwrap();
        std::fs::write(w.meta_dir().join("deploy.lock"), "old").unwrap();

        assert!(w.reset_managed_keys());
        assert!(!w.is_taken_over());
        assert!(!w.reset_managed_keys(), "重复清理应返回 false");

        assert!(w.clear_deploy_lock());
        assert!(!w.clear_deploy_lock());
    }
}
