//! Tauri 命令层：薄，只做参数校验、调用 `qieyun-kit`、返回 DTO。
//! 契约见 `apps/desktop/src/lib/ipc.ts`（命名保持 snake_case）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use qieyun_kit::patch::Edit;
use qieyun_kit::workspace::Workspace;
use qieyun_kit::{env, profile, snapshot};

use crate::paths::Ctx;

// ---------------------------------------------------------------------------
// DTO（与前端 TypeScript 契约一一对应）
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct EnvInfoDto {
    rime_user_dir: String,
    shared_dir: String,
    platform: String,
    rime_version: String,
}

#[derive(Debug, Serialize)]
pub struct SchemaDto {
    id: String,
    name: String,
    enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct ProfileDto {
    schemas: Vec<SchemaDto>,
    themes: Vec<String>,
    default_schema: String,
}

#[derive(Debug, Serialize)]
pub struct SnapshotDto {
    id: String,
    created_at: String,
    note: String,
}

#[derive(Debug, Serialize)]
pub struct SnapshotCreatedDto {
    id: String,
}

#[derive(Debug, Serialize)]
pub struct DeployDto {
    ok: bool,
    log: String,
}

#[derive(Debug, Serialize)]
pub struct FileContentDto {
    content: String,
}

#[derive(Debug, Serialize)]
pub struct WriteDto {
    written_files: Vec<String>,
}

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_env_info() -> Result<EnvInfoDto, String> {
    let ctx = Ctx::resolve();
    let info = env::probe(Some(&ctx.user_dir));
    Ok(EnvInfoDto {
        rime_user_dir: info.user_dir.display().to_string(),
        shared_dir: info
            .shared_dir
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        platform: info.platform,
        rime_version: info.rime_version.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn scan_profile() -> Result<ProfileDto, String> {
    let ctx = Ctx::resolve();
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    let p = profile::scan(&ctx.user_dir, shared.as_deref());
    Ok(ProfileDto {
        schemas: p
            .schemas
            .into_iter()
            .map(|s| SchemaDto { id: s.id, name: s.name, enabled: s.enabled })
            .collect(),
        themes: p.themes,
        default_schema: p.default_schema.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn list_snapshots() -> Result<Vec<SnapshotDto>, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    let items = snapshot::list(&ws.snapshots_dir()).map_err(|e| e.to_string())?;
    Ok(items
        .into_iter()
        .map(|s| SnapshotDto { id: s.id, created_at: s.created_at, note: s.note })
        .collect())
}

#[tauri::command]
pub fn create_snapshot(note: String) -> Result<SnapshotCreatedDto, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    std::fs::create_dir_all(ws.snapshots_dir()).map_err(|e| e.to_string())?;
    let info = snapshot::create(&ctx.user_dir, &ws.snapshots_dir(), &note)
        .map_err(|e| e.to_string())?;
    Ok(SnapshotCreatedDto { id: info.id })
}

/// 用内嵌/外部的 `rime_deployer` 部署。M1 阶段先用官方 CLI（见 roadmap 风险退路），
/// 待 librime 绑定就绪后换成进程内 deploy。
#[tauri::command]
pub fn deploy() -> Result<DeployDto, String> {
    let ctx = Ctx::resolve();
    let deployer = find_deployer().ok_or_else(|| {
        "找不到 rime_deployer。请先运行 scripts/build-librime-macos.sh，或用 QIEYUN_RIME_DEPLOYER 指定路径。"
            .to_string()
    })?;

    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    // rime_deployer 的参数是位置参数：--build [user] [shared] [staging]
    // 见 librime/tools/rime_deployer.cc
    let mut cmd = std::process::Command::new(&deployer);
    cmd.arg("--build").arg(&ctx.user_dir);
    cmd.arg(shared.as_deref().unwrap_or(&ctx.user_dir));
    cmd.arg(ctx.user_dir.join("build"));

    let output = cmd.output().map_err(|e| format!("启动部署器失败：{e}"))?;
    let mut log = String::new();
    log.push_str(&format!("$ {} {:?}\n", deployer.display(), cmd.get_args().collect::<Vec<_>>()));
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(DeployDto { ok: output.status.success(), log })
}

#[tauri::command]
pub fn read_file(path: String) -> Result<FileContentDto, String> {
    let ctx = Ctx::resolve();
    let checked = ctx.within_user_dir(Path::new(&path))?;
    let content = std::fs::read_to_string(&checked)
        .map_err(|e| format!("读取 {} 失败：{e}", checked.display()))?;
    Ok(FileContentDto { content })
}

#[derive(Debug, Deserialize)]
pub struct GuiPatch {
    /// 文件名 → 该文件的编辑序列。
    #[serde(default)]
    pub files: BTreeMap<String, Vec<EditPayload>>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum EditPayload {
    Set { key: String, value: Value },
    SetRaw { key: String, raw: String },
    Remove { key: String },
}

impl From<EditPayload> for Edit {
    fn from(payload: EditPayload) -> Self {
        match payload {
            EditPayload::Set { key, value } => Edit::set(key, value),
            EditPayload::SetRaw { key, raw } => Edit::set_raw(key, raw),
            EditPayload::Remove { key } => Edit::remove(key),
        }
    }
}

/// 唯一的写入口：委托给 `qieyun-kit::Workspace`（快照 → 漂移 → 写回 → 记账）。
#[tauri::command]
pub fn write_gui_config(patch: GuiPatch) -> Result<WriteDto, String> {
    let ctx = Ctx::resolve();
    let files: BTreeMap<String, Vec<Edit>> = patch
        .files
        .iter()
        .map(|(name, payloads)| (name.clone(), payloads.iter().cloned().map(Edit::from).collect()))
        .collect();

    let ws = Workspace::new(&ctx.user_dir);
    let outcome = ws
        .write_patch(&files, patch.note.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(WriteDto { written_files: outcome.written_files })
}

/// 查找 `rime_deployer`：环境变量 → PATH → 仓库开发目录。
fn find_deployer() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("QIEYUN_RIME_DEPLOYER") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join("rime_deployer");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // 开发环境：仓库根下 .deps/librime/dist/bin/rime_deployer
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.deps/librime/dist/bin/rime_deployer");
    dev.is_file().then_some(dev)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edit_payload_deserializes_from_json_shape() {
        let payload: EditPayload =
            serde_json::from_str(r#"{"op":"set","key":"style/font_point","value":14}"#).unwrap();
        let edit = Edit::from(payload);
        assert_eq!(edit.key(), "style/font_point");

        let raw: EditPayload = serde_json::from_str(
            r#"{"op":"setraw","key":"preset_color_schemes/x","raw":"back_color: 0x112233"}"#,
        )
        .unwrap();
        assert!(matches!(Edit::from(raw), Edit::SetRaw { .. }));

        let removed: EditPayload =
            serde_json::from_str(r#"{"op":"remove","key":"a/b"}"#).unwrap();
        assert!(matches!(Edit::from(removed), Edit::Remove { .. }));
    }

    #[test]
    fn gui_patch_deserializes() {
        let p: GuiPatch = serde_json::from_str(
            r#"{"files":{"squirrel.custom.yaml":[{"op":"set","key":"a","value":1}]},"note":"t"}"#,
        )
        .unwrap();
        assert_eq!(p.files.len(), 1);
        assert_eq!(p.note.as_deref(), Some("t"));
    }
}
