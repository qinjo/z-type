//! 用户目录工作区：把"快照 → 漂移检测 → 文本级写回 → 原子落盘 → 记账"编排成一个可测试的动作。
//!
//! 这是 GUI 唯一的写入口。Tauri 层只做参数反序列化，不做任何业务判断。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::manifest::{Drift, State};
use crate::patch::{apply_edits, CreatePolicy, Edit};
use crate::{snapshot, time};

pub const META_DIR: &str = ".qieyun";

/// 遇到"未托管键冲突"时的行为。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictPolicy {
    /// 默认：中止并请用户确认。
    Abort,
    /// 用户已确认覆盖：未托管键登记为 GUI 所有、漂移键重新登记哈希，然后继续写。
    Adopt,
}

/// 冲突种类，供前端分文案。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// 文件里有、但从未托管的键（用户手写 / 别的工具写的）。
    Unmanaged,
    /// 已托管，但之后被用户手改过。
    Drift,
}

impl ConflictKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ConflictKind::Unmanaged => "unmanaged",
            ConflictKind::Drift => "drift",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum WriteError {
    #[error("拒绝写入非 custom 文件或非法文件名：{0}")]
    InvalidFile(String),
    #[error("{file} 中的这些键被手动修改过，已中止写入：{keys}")]
    Drift { file: String, keys: String },
    #[error("{file} 中的这些键是你手写的、尚未由切韵接管，已中止写入：{keys}")]
    UnmanagedKeys { file: String, keys: String },
    #[error("读取 {file} 失败：{source}")]
    Read {
        file: String,
        #[source]
        source: std::io::Error,
    },
    #[error("写入过程中失败，已回滚：{0}")]
    RolledBack(String),
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
            WriteError::Drift { file, keys } | WriteError::UnmanagedKeys { file, keys } => {
                Some((file, keys.split('、').filter(|s| !s.is_empty()).collect()))
            }
            _ => None,
        }
    }

    /// 是否属于"需要用户确认才能继续写"的冲突。
    pub fn is_conflict(&self) -> bool {
        self.conflict().is_some()
    }

    /// 冲突的结构化信息（种类 + 文件 + 键），供 UI 弹确认框。
    pub fn conflict(&self) -> Option<(ConflictKind, &str, Vec<&str>)> {
        match self {
            WriteError::Drift { file, keys } => Some((
                ConflictKind::Drift,
                file,
                keys.split('、').filter(|s| !s.is_empty()).collect(),
            )),
            WriteError::UnmanagedKeys { file, keys } => Some((
                ConflictKind::Unmanaged,
                file,
                keys.split('、').filter(|s| !s.is_empty()).collect(),
            )),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WriteOutcome {
    pub written_files: Vec<String>,
    pub snapshot_id: Option<String>,
}

/// 一次写入中单个文件的待提交状态。
struct PendingFile {
    name: String,
    path: PathBuf,
    /// 写入前文件是否存在（回滚时决定"恢复"还是"删除"）。
    existed: bool,
    before: String,
    after: String,
    edits: Vec<Edit>,
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

    /// 应用一批写入意图（默认遇到未托管键冲突就中止）。
    pub fn write_patch(
        &self,
        files: &BTreeMap<String, Vec<Edit>>,
        note: Option<&str>,
    ) -> Result<WriteOutcome, WriteError> {
        self.write_patch_with(files, note, ConflictPolicy::Abort)
    }

    /// 应用一批写入意图。
    ///
    /// 流程：快照 → 逐文件校验（漂移 / 未托管键 / YAML 合法性）→ 全部通过后统一落盘 →
    /// 记账。落盘阶段任一文件失败会**回滚已写的文件**，保证不会留下半套配置。
    pub fn write_patch_with(
        &self,
        files: &BTreeMap<String, Vec<Edit>>,
        note: Option<&str>,
        policy: ConflictPolicy,
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
            // 顺手清理过旧快照，避免磁盘无限增长（失败不影响主流程）
            let _ = snapshot::prune(&self.snapshots_dir(), snapshot::DEFAULT_KEEP);
            snapshot_id = Some(info.id);
        }

        let mut state =
            State::load(&self.state_path()).map_err(|e| WriteError::State(e.to_string()))?;
        let now = time::format_iso8601_utc(time::now_unix());

        let mut pending: Vec<PendingFile> = Vec::new();

        for (name, edits) in files {
            let path = self.custom_file(name)?;
            let (before, existed) = self.read_optional(name, &path)?;

            // 1a) 已托管键被手改 → 漂移
            let drift = state.detect_drift(name, &before);
            if !drift.is_empty() {
                match policy {
                    ConflictPolicy::Abort => {
                        return Err(WriteError::Drift {
                            file: name.clone(),
                            keys: drift.iter().map(|d| d.key()).collect::<Vec<_>>().join("、"),
                        });
                    }
                    ConflictPolicy::Adopt => {
                        // 用户已确认"用切韵的值覆盖"：把当前值重新登记为基线，
                        // 否则同一次写入会立刻再次被判为漂移（死路）。
                        for key in drift.iter().map(|d| d.key()) {
                            state.record(name, key, &before, &now);
                        }
                    }
                }
            }

            // 1b) 文件里有、但从未托管的键 → 必须先确认，绝不静默覆盖
            let keys: Vec<&str> = edits.iter().map(|e| e.key()).collect();
            let unmanaged = state.detect_unmanaged(name, &before, &keys);
            if !unmanaged.is_empty() {
                match policy {
                    ConflictPolicy::Abort => {
                        return Err(WriteError::UnmanagedKeys {
                            file: name.clone(),
                            keys: unmanaged.join("、"),
                        });
                    }
                    ConflictPolicy::Adopt => {
                        // 用户已确认：把旧值登记为"托管"，随后正常覆盖
                        for key in &unmanaged {
                            state.record(name, key, &before, &now);
                        }
                    }
                }
            }

            let after = apply_edits(&before, edits, CreatePolicy::Create).map_err(|e| {
                WriteError::Patch {
                    file: name.clone(),
                    source: e,
                }
            })?;
            pending.push(PendingFile {
                name: name.clone(),
                path,
                existed,
                before,
                after,
                edits: edits.clone(),
            });
        }

        // 2) 落盘 + 记账（失败回滚已写文件）
        let mut written: Vec<String> = Vec::new();
        let mut committed: Vec<&PendingFile> = Vec::new();
        for item in &pending {
            if item.after == item.before {
                continue;
            }
            if let Err(source) = atomic_write(&item.path, &item.after) {
                let rolled = Self::rollback(&committed);
                return Err(WriteError::RolledBack(format!(
                    "写入 {} 失败：{source}；已回滚 {} 个文件{}",
                    item.name,
                    rolled.0,
                    if rolled.1.is_empty() {
                        String::new()
                    } else {
                        format!("（回滚时又有失败：{}）", rolled.1.join("、"))
                    }
                )));
            }
            committed.push(item);
            written.push(item.name.clone());
        }

        for item in &pending {
            state.record_edits(&item.name, &item.after, &item.edits, &now);
        }
        if let Err(e) = state.save(&self.state_path()) {
            let rolled = Self::rollback(&committed);
            return Err(WriteError::RolledBack(format!(
                "保存状态文件失败：{e}；已回滚 {} 个文件{}",
                rolled.0,
                if rolled.1.is_empty() {
                    String::new()
                } else {
                    format!("（回滚时又有失败：{}）", rolled.1.join("、"))
                }
            )));
        }

        Ok(WriteOutcome {
            written_files: if written.is_empty() {
                pending.iter().map(|p| p.name.clone()).collect()
            } else {
                written
            },
            snapshot_id,
        })
    }

    /// 读文件：只有"不存在"才算空文件；其它错误（权限、非 UTF-8）必须中止，
    /// 否则会用新内容覆盖掉读不出来的旧内容。
    fn read_optional(&self, name: &str, path: &Path) -> Result<(String, bool), WriteError> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok((text, true)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), false)),
            Err(source) => Err(WriteError::Read {
                file: name.to_string(),
                source,
            }),
        }
    }

    /// 尽力回滚：把已写文件恢复成写前内容（原先不存在的则删除）。返回(成功数, 失败文件名)。
    fn rollback(items: &[&PendingFile]) -> (usize, Vec<String>) {
        let mut ok = 0;
        let mut failed = Vec::new();
        for item in items {
            let result = if item.existed {
                atomic_write(&item.path, &item.before)
            } else {
                std::fs::remove_file(&item.path)
            };
            match result {
                Ok(()) => ok += 1,
                Err(_) => failed.push(item.name.clone()),
            }
        }
        (ok, failed)
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

        // 第一次写入：文件里已有该键但未托管 → 必须先显式接管
        w.write_patch_with(
            &files(&[(
                "squirrel.custom.yaml",
                vec![Edit::set("style/font_point", Value::from(14u64))],
            )]),
            None,
            ConflictPolicy::Adopt,
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
    fn aborts_on_unmanaged_keys_unless_adopted() {
        let w = ws("unmanaged");
        let path = w.user_dir.join("squirrel.custom.yaml");
        // 用户手写的键，state 里没有登记
        std::fs::write(&path, "patch:\n  style/font_point: 13\n").unwrap();

        let edits = files(&[(
            "squirrel.custom.yaml",
            vec![Edit::set("style/font_point", Value::from(14u64))],
        )]);

        // 默认：中止，且文件一个字节都不动
        let err = w.write_patch(&edits, None).unwrap_err();
        assert!(matches!(err, WriteError::UnmanagedKeys { .. }), "{err:?}");
        assert!(err.is_conflict());
        assert_eq!(
            err.drift_keys(),
            Some(("squirrel.custom.yaml", vec!["style/font_point"]))
        );
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "patch:\n  style/font_point: 13\n"
        );

        // 确认接管后：写入成功，且后续变更走正常漂移检测
        w.write_patch_with(&edits, None, ConflictPolicy::Adopt)
            .unwrap();
        assert!(std::fs::read_to_string(&path)
            .unwrap()
            .contains("style/font_point: 14"));
    }

    #[test]
    fn adopt_can_override_drift() {
        // 审查反馈：Adopt 只放行未托管键，漂移键会被二次拒绝 → 覆盖按钮成了死路。
        let w = ws("adopt-drift");
        let path = w.user_dir.join("squirrel.custom.yaml");
        std::fs::write(&path, "patch:\n  style/font_point: 12\n").unwrap();

        let edits = files(&[(
            "squirrel.custom.yaml",
            vec![Edit::set("style/font_point", Value::from(14u64))],
        )]);

        // 首写：未托管 → Abort 拒绝
        assert!(matches!(
            w.write_patch(&edits, None).unwrap_err(),
            WriteError::UnmanagedKeys { .. }
        ));
        // 接管
        w.write_patch_with(&edits, None, ConflictPolicy::Adopt)
            .unwrap();

        // 用户手改 → 漂移
        std::fs::write(&path, "patch:\n  style/font_point: 20\n").unwrap();
        let err = w.write_patch(&edits, None).unwrap_err();
        assert!(matches!(err, WriteError::Drift { .. }));
        assert_eq!(err.conflict().map(|c| c.0), Some(ConflictKind::Drift));

        // Abort 时不写；Adopt 时允许覆盖并重新登记
        assert!(std::fs::read_to_string(&path).unwrap().contains("20"));
        w.write_patch_with(&edits, None, ConflictPolicy::Adopt)
            .unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("14"));

        // 覆盖之后不再漂移：后续普通写入可直接进行（证明哈希已重新登记）
        w.write_patch(
            &files(&[(
                "squirrel.custom.yaml",
                vec![Edit::set("style/font_point", Value::from(15u64))],
            )]),
            None,
        )
        .unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("15"));
    }

    #[test]
    fn new_keys_are_not_conflicts() {
        let w = ws("newkey");
        let path = w.user_dir.join("squirrel.custom.yaml");
        std::fs::write(&path, "patch:\n  style/font_point: 13\n").unwrap();
        // 写一个文件里不存在的键：不是冲突，直接允许
        let edits = files(&[(
            "squirrel.custom.yaml",
            vec![Edit::set("style/color_scheme", "native")],
        )]);
        w.write_patch(&edits, None).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("style/color_scheme: native"));
        assert!(
            text.contains("style/font_point: 13"),
            "他人手写的键必须原样保留"
        );
    }

    #[test]
    fn read_errors_are_not_treated_as_empty_file() {
        let w = ws("readerr");
        // 同名目标是目录 → read_to_string 会返回 IsADirectory，不能被当成空文件
        std::fs::create_dir_all(w.user_dir.join("squirrel.custom.yaml")).unwrap();
        let edits = files(&[(
            "squirrel.custom.yaml",
            vec![Edit::set("style/font_point", Value::from(14u64))],
        )]);
        let err = w
            .write_patch_with(&edits, None, ConflictPolicy::Adopt)
            .unwrap_err();
        assert!(
            matches!(
                err,
                WriteError::Read { .. } | WriteError::RolledBack(_) | WriteError::Io { .. }
            ),
            "读失败必须报错而不是当空文件：{err:?}"
        );
    }

    #[test]
    fn failed_commit_rolls_back_previous_files() {
        let w = ws("rollback");
        std::fs::write(w.user_dir.join("a.custom.yaml"), "patch:\n  x: 1\n").unwrap();
        // b 的目标是一个目录 → rename 必然失败
        std::fs::create_dir_all(w.user_dir.join("b.custom.yaml")).unwrap();

        let edits = files(&[
            ("a.custom.yaml", vec![Edit::set("x", Value::from(2u64))]),
            ("b.custom.yaml", vec![Edit::set("y", Value::from(3u64))]),
        ]);
        let err = w
            .write_patch_with(&edits, None, ConflictPolicy::Adopt)
            .unwrap_err();
        assert!(
            matches!(err, WriteError::RolledBack(_) | WriteError::Read { .. }),
            "应失败并回滚：{err:?}"
        );
        // 关键：a 必须回到原值，不能停在半提交状态
        assert_eq!(
            std::fs::read_to_string(w.user_dir.join("a.custom.yaml")).unwrap(),
            "patch:\n  x: 1\n"
        );
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
        self.apply_theme_with(theme, platform, note, ConflictPolicy::Abort)
    }

    /// 同上，但可指定冲突策略（用户确认覆盖时传 `Adopt`）。
    pub fn apply_theme_with(
        &self,
        theme: &crate::theme::Theme,
        platform: crate::platform::Platform,
        note: Option<&str>,
        policy: ConflictPolicy,
    ) -> Result<WriteOutcome, WriteError> {
        let file = match platform {
            crate::platform::Platform::Macos => "squirrel.custom.yaml",
            crate::platform::Platform::Windows => "weasel.custom.yaml",
        };
        let edits = theme.edits(platform);
        let mut files = BTreeMap::new();
        files.insert(file.to_string(), edits);
        self.write_patch_with(&files, note, policy)
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
