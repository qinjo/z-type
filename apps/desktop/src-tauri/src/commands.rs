//! Tauri 命令层：薄，只做参数校验、调用 `qieyun-kit`、返回 DTO。
//! 契约见 `apps/desktop/src/lib/ipc.ts`（命名保持 snake_case）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use qieyun_kit::input::{AsciiToggleKey, InputSettings, PageKeys};
use qieyun_kit::patch::Edit;
use qieyun_kit::platform::Platform;
use qieyun_kit::theme::{Colors, Font, Layout, Orientation, Rgba, Theme};
use qieyun_kit::workspace::Workspace;
use qieyun_kit::{env, profile, reload, snapshot};

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
    is_shuangpin: bool,
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
            .map(|s| SchemaDto {
                id: s.id,
                name: s.name,
                enabled: s.enabled,
                is_shuangpin: s.is_shuangpin,
            })
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
        .map(|s| SnapshotDto {
            id: s.id,
            created_at: s.created_at,
            note: s.note,
        })
        .collect())
}

#[tauri::command]
pub fn create_snapshot(note: String) -> Result<SnapshotCreatedDto, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    std::fs::create_dir_all(ws.snapshots_dir()).map_err(|e| e.to_string())?;
    let info =
        snapshot::create(&ctx.user_dir, &ws.snapshots_dir(), &note).map_err(|e| e.to_string())?;
    Ok(SnapshotCreatedDto { id: info.id })
}

/// 用内嵌/外部的 `rime_deployer` 部署。M1 阶段先用官方 CLI（见 roadmap 风险退路），
/// 待 librime 绑定就绪后换成进程内 deploy。
#[tauri::command]
pub fn deploy() -> Result<DeployDto, String> {
    let ctx = Ctx::resolve();
    let _lock = DeployLock::acquire(&Workspace::new(&ctx.user_dir))?;
    // librime 的 WorkspaceUpdate 按「秒级 mtime」判断配置是否变化；
    // 同一秒内连续部署会被判定为"无变化"而跳过。这里对齐到下一秒边界，
    // 保证用户点两次「保存并部署」时第二次一定生效。
    align_deploy_to_next_second(&ctx);

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
    log.push_str(&format!(
        "$ {} {:?}\n",
        deployer.display(),
        cmd.get_args().collect::<Vec<_>>()
    ));
    log.push_str(&String::from_utf8_lossy(&output.stdout));
    log.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(DeployDto {
        ok: output.status.success(),
        log,
    })
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
        .map(|(name, payloads)| {
            (
                name.clone(),
                payloads.iter().cloned().map(Edit::from).collect(),
            )
        })
        .collect();

    let ws = Workspace::new(&ctx.user_dir);
    let outcome = ws
        .write_patch(&files, patch.note.as_deref())
        .map_err(|e| e.to_string())?;
    Ok(WriteDto {
        written_files: outcome.written_files,
    })
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
    let dev =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../.deps/librime/dist/bin/rime_deployer");
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

        let removed: EditPayload = serde_json::from_str(r#"{"op":"remove","key":"a/b"}"#).unwrap();
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

// ---------------------------------------------------------------------------
// 首启接管
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct TakeoverPlanDto {
    taken_over: bool,
    user_dir: String,
    schema_count: usize,
    custom_files: Vec<String>,
    snapshot_dir: String,
}

#[derive(Debug, Serialize)]
pub struct TakeoverResultDto {
    snapshot_id: String,
    user_dir: String,
}

#[tauri::command]
pub fn get_takeover_plan() -> Result<TakeoverPlanDto, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    let p = profile::scan(&ctx.user_dir, shared.as_deref());
    Ok(TakeoverPlanDto {
        taken_over: ws.is_taken_over(),
        user_dir: ctx.user_dir.display().to_string(),
        schema_count: p.schemas.len(),
        custom_files: p.custom_files,
        snapshot_dir: ws.snapshots_dir().display().to_string(),
    })
}

/// 首启接管：备份 + 建立托管键清单，不改任何配置。
#[tauri::command]
pub fn accept_takeover() -> Result<TakeoverResultDto, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    let snap = ws.takeover("首次接管自动备份").map_err(|e| e.to_string())?;
    Ok(TakeoverResultDto {
        snapshot_id: snap.id,
        user_dir: ctx.user_dir.display().to_string(),
    })
}

// ---------------------------------------------------------------------------
// 主题
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct FontDto {
    face: String,
    point: u16,
    label_point: u16,
    line_spacing: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LayoutDto {
    /// "horizontal" | "vertical"
    orientation: String,
    corner_radius: u16,
    border_width: u16,
    margin: u16,
    spacing: u16,
    shadow: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ThemeDto {
    name: String,
    font: FontDto,
    layout: LayoutDto,
    /// 槽位名 → `#RRGGBB(AA)`。
    colors: BTreeMap<String, String>,
}

fn theme_to_dto(theme: &Theme) -> ThemeDto {
    let mut colors = BTreeMap::new();
    for (key, value) in [
        ("back", theme.colors.back),
        ("border", theme.colors.border),
        ("text", theme.colors.text),
        ("candidate_text", theme.colors.candidate_text),
        ("comment_text", theme.colors.comment_text),
        ("hilited_back", theme.colors.hilited_back),
        ("hilited_text", theme.colors.hilited_text),
        (
            "hilited_candidate_back",
            theme.colors.hilited_candidate_back,
        ),
        (
            "hilited_candidate_text",
            theme.colors.hilited_candidate_text,
        ),
        (
            "hilited_candidate_border",
            theme.colors.hilited_candidate_border,
        ),
        ("hilited_border", theme.colors.hilited_border),
    ] {
        colors.insert(key.to_string(), value.to_hex());
    }
    ThemeDto {
        name: theme.name.clone(),
        font: FontDto {
            face: theme.font.face.clone(),
            point: theme.font.point,
            label_point: theme.font.label_point,
            line_spacing: theme.font.line_spacing,
        },
        layout: LayoutDto {
            orientation: match theme.layout.orientation {
                Orientation::Horizontal => "horizontal".into(),
                Orientation::Vertical => "vertical".into(),
            },
            corner_radius: theme.layout.corner_radius,
            border_width: theme.layout.border_width,
            margin: theme.layout.margin,
            spacing: theme.layout.spacing,
            shadow: theme.layout.shadow,
        },
        colors,
    }
}

fn dto_to_theme(dto: &ThemeDto) -> Result<Theme, String> {
    let color = |key: &str| -> Result<Rgba, String> {
        let hex = dto
            .colors
            .get(key)
            .ok_or_else(|| format!("主题缺少颜色槽：{key}"))?;
        Rgba::parse(hex).ok_or_else(|| format!("颜色格式非法：{key}={hex}"))
    };
    Ok(Theme {
        name: dto.name.clone(),
        font: Font {
            face: dto.font.face.clone(),
            point: dto.font.point,
            label_point: dto.font.label_point,
            line_spacing: dto.font.line_spacing,
        },
        layout: Layout {
            orientation: if dto.layout.orientation == "vertical" {
                Orientation::Vertical
            } else {
                Orientation::Horizontal
            },
            corner_radius: dto.layout.corner_radius,
            border_width: dto.layout.border_width,
            margin: dto.layout.margin,
            spacing: dto.layout.spacing,
            shadow: dto.layout.shadow,
        },
        colors: Colors {
            back: color("back")?,
            border: color("border")?,
            text: color("text")?,
            candidate_text: color("candidate_text")?,
            comment_text: color("comment_text")?,
            hilited_back: color("hilited_back")?,
            hilited_text: color("hilited_text")?,
            hilited_candidate_back: color("hilited_candidate_back")?,
            hilited_candidate_text: color("hilited_candidate_text")?,
            hilited_candidate_border: color("hilited_candidate_border")?,
            hilited_border: color("hilited_border")?,
        },
        platform_specific: BTreeMap::new(),
    })
}

/// 内置主题预设（前端外观页直接渲染这些）。
#[tauri::command]
pub fn list_theme_presets() -> Vec<ThemeDto> {
    Theme::presets().iter().map(theme_to_dto).collect()
}

/// 应用主题：编译成目标平台的样式文件并写入（不部署、不重载）。
#[tauri::command]
pub fn apply_theme(theme: ThemeDto) -> Result<WriteDto, String> {
    let ctx = Ctx::resolve();
    let ws = Workspace::new(&ctx.user_dir);
    let theme = dto_to_theme(&theme)?;
    let outcome = ws
        .apply_theme(&theme, Platform::current(), Some("应用主题"))
        .map_err(|e| e.to_string())?;
    Ok(WriteDto {
        written_files: outcome.written_files,
    })
}

/// 部署 + 重载外壳：Windows 由 WeaselDeployer 一并完成；macOS 先 deploy 再发 reload 通知。
#[tauri::command]
pub fn apply_and_deploy() -> Result<DeployDto, String> {
    let deploy = deploy()?;
    let mut log = deploy.log;

    if deploy.ok {
        let plan = reload::plan(Platform::current(), Path::new(""));
        if plan.looks_installed() {
            match std::process::Command::new(&plan.program)
                .args(&plan.args)
                .status()
            {
                Ok(status) => log.push_str(&format!(
                    "\n[reload] {} {:?} → {status}",
                    plan.program.display(),
                    plan.args
                )),
                Err(e) => log.push_str(&format!("\n[reload] 失败：{e}。{}", plan.fallback_hint)),
            }
        } else {
            log.push_str(&format!(
                "\n[reload] 未找到外壳：{}。{}",
                plan.program.display(),
                plan.fallback_hint
            ));
        }
    }

    Ok(DeployDto { ok: deploy.ok, log })
}

#[cfg(test)]
mod theme_dto_tests {
    use super::*;

    #[test]
    fn theme_dto_roundtrips_through_presets() {
        for preset in Theme::presets() {
            let dto = theme_to_dto(&preset);
            let back = dto_to_theme(&dto).unwrap();
            assert_eq!(back, preset, "预设 {} 往返后不一致", preset.name);
        }
    }

    #[test]
    fn invalid_color_is_rejected() {
        let mut dto = theme_to_dto(&Theme::presets()[0]);
        dto.colors.insert("back".into(), "not-a-color".into());
        assert!(dto_to_theme(&dto).is_err());
    }

    #[test]
    fn missing_color_slot_is_rejected() {
        let mut dto = theme_to_dto(&Theme::presets()[0]);
        dto.colors.remove("text");
        assert!(dto_to_theme(&dto).is_err());
    }
}

// ---------------------------------------------------------------------------
// 部署锁：同一时间只允许一个部署（GUI 实例 / 用户手动部署可能撞车）
// ---------------------------------------------------------------------------

struct DeployLock {
    path: PathBuf,
}

impl DeployLock {
    /// 陈旧锁（超过 120 秒）视为上一次部署崩溃留下的，直接抢占。
    fn acquire(ws: &Workspace) -> Result<Self, String> {
        let dir = ws.meta_dir();
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建状态目录失败：{e}"))?;
        let path = dir.join("deploy.lock");

        if let Ok(text) = std::fs::read_to_string(&path) {
            let stale = text
                .split_whitespace()
                .next()
                .and_then(|ts| ts.parse::<u64>().ok())
                .map(|ts| qieyun_kit::time::now_unix().saturating_sub(ts) > 120)
                .unwrap_or(true);
            if !stale {
                return Err(format!(
                    "已有部署在进行中（锁文件：{}）。请等待完成，或删除该文件后重试。",
                    path.display()
                ));
            }
        }

        let body = format!("{} {}", qieyun_kit::time::now_unix(), std::process::id());
        std::fs::write(&path, body).map_err(|e| format!("写入部署锁失败：{e}"))?;
        Ok(DeployLock { path })
    }
}

impl Drop for DeployLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

// ---------------------------------------------------------------------------
// 输入方案与按键（default.custom.yaml）
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct InputSettingsDto {
    schema_list: Vec<String>,
    page_size: u8,
    page_keys: PageKeys,
    toggle_ascii: AsciiToggleKey,
}

fn read_default_custom(ctx: &Ctx) -> Result<serde_yaml::Value, String> {
    let path = ctx.user_dir.join("default.custom.yaml");
    match std::fs::read_to_string(&path) {
        Ok(text) if !text.trim().is_empty() => {
            serde_yaml::from_str(&text).map_err(|e| format!("解析 default.custom.yaml 失败：{e}"))
        }
        _ => Ok(serde_yaml::Value::Null),
    }
}

/// 读取当前输入设置。若 `default.custom.yaml` 里没有 `schema_list`，
/// 用生效中的方案列表兜底（来自共享/用户 default.yaml）。
#[tauri::command]
pub fn get_input_settings() -> Result<InputSettingsDto, String> {
    let ctx = Ctx::resolve();
    let root = read_default_custom(&ctx)?;
    let mut settings = InputSettings::from_yaml(&root);

    if settings.schema_list.is_empty() {
        let shared = env::detect_shared_dir(&env::shared_dir_candidates());
        settings.schema_list = profile::schema_list(&ctx.user_dir, shared.as_deref());
    }

    Ok(InputSettingsDto {
        schema_list: settings.schema_list,
        page_size: settings.page_size,
        page_keys: settings.page_keys,
        toggle_ascii: settings.toggle_ascii,
    })
}

/// 写入方案顺序/候选数/翻页键/中英切换。只替换 GUI 管的那批绑定，用户自建绑定保留。
#[tauri::command]
pub fn apply_input_settings(settings: InputSettings) -> Result<WriteDto, String> {
    settings.validate().map_err(|e| e.to_string())?;
    let ctx = Ctx::resolve();
    let root = read_default_custom(&ctx)?;
    let edits = settings.edits(&root);

    let mut files = BTreeMap::new();
    files.insert("default.custom.yaml".to_string(), edits);

    let ws = Workspace::new(&ctx.user_dir);
    let outcome = ws
        .write_patch(&files, Some("修改方案与按键"))
        .map_err(|e| e.to_string())?;
    Ok(WriteDto {
        written_files: outcome.written_files,
    })
}

#[cfg(test)]
mod input_dto_tests {
    use super::*;

    #[test]
    fn settings_deserialize_from_json_contract() {
        let json = r#"{
            "schema_list": ["rime_ice", "double_pinyin_flypy"],
            "page_size": 9,
            "page_keys": "bracket",
            "toggle_ascii": "shift_left"
        }"#;
        let s: InputSettings = serde_json::from_str(json).unwrap();
        assert_eq!(s.schema_list.len(), 2);
        assert_eq!(s.page_size, 9);
        assert_eq!(s.page_keys, PageKeys::Bracket);
        assert_eq!(s.toggle_ascii, AsciiToggleKey::ShiftLeft);
    }

    #[test]
    fn enums_serialize_to_snake_case() {
        let dto = InputSettingsDto {
            schema_list: vec!["a".into()],
            page_size: 7,
            page_keys: PageKeys::PageUpDown,
            toggle_ascii: AsciiToggleKey::ControlShiftSpace,
        };
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("page_up_down"), "{json}");
        assert!(json.contains("control_shift_space"), "{json}");
    }
}

/// 若距离上次部署不足 1 秒，等到下一秒再部署。
fn align_deploy_to_next_second(ctx: &Ctx) {
    let stamp = Workspace::new(&ctx.user_dir).meta_dir().join("last_deploy");
    let last = std::fs::read_to_string(&stamp)
        .ok()
        .and_then(|t| t.trim().parse::<u64>().ok());
    let now = qieyun_kit::time::now_unix();
    if let Some(last) = last {
        if now <= last {
            let wait_ms = (last + 1 - now) * 1000 + 50;
            std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        }
    }
    let _ = std::fs::create_dir_all(Workspace::new(&ctx.user_dir).meta_dir());
    let _ = std::fs::write(stamp, qieyun_kit::time::now_unix().to_string());
}

// ---------------------------------------------------------------------------
// 方案详情 / 模糊音（M4）
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct FuzzyGroupDto {
    id: String,
    label: String,
    rules: Vec<String>,
    enabled: bool,
}

#[derive(Debug, Serialize)]
pub struct FuzzySettingsDto {
    schema_id: String,
    schema_name: String,
    compiled: bool,
    rule_count: usize,
    groups: Vec<FuzzyGroupDto>,
}

fn active_schema_id(ctx: &Ctx) -> String {
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    profile::schema_list(&ctx.user_dir, shared.as_deref())
        .into_iter()
        .next()
        .unwrap_or_else(|| "rime_ice".to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_schema_detail(
    schema_id: Option<String>,
) -> Result<qieyun_kit::detail::SchemaDetail, String> {
    let ctx = Ctx::resolve();
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    let id = schema_id.unwrap_or_else(|| active_schema_id(&ctx));
    Ok(qieyun_kit::detail::read_schema_detail(
        &ctx.user_dir,
        shared.as_deref(),
        &id,
    ))
}

#[tauri::command]
pub fn get_fuzzy_settings() -> Result<FuzzySettingsDto, String> {
    let ctx = Ctx::resolve();
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    let id = active_schema_id(&ctx);
    let detail = qieyun_kit::detail::read_schema_detail(&ctx.user_dir, shared.as_deref(), &id);

    // 优先级：自定义层（用户刚保存的意图） > 编译产物（当前实际生效）。
    // 这样"保存了但还没部署"时，界面显示的仍然是刚勾选的状态；部署后两者一致。
    let custom_algebra = std::fs::read_to_string(ctx.user_dir.join(format!("{id}.custom.yaml")))
        .ok()
        .and_then(|t| serde_yaml::from_str::<serde_yaml::Value>(&t).ok())
        .and_then(|root| {
            root.get("patch")?
                .get("speller/algebra")?
                .as_sequence()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
        })
        .unwrap_or_else(|| detail.algebra.clone());

    let enabled = qieyun_kit::fuzzy::detect(&custom_algebra);

    Ok(FuzzySettingsDto {
        schema_id: detail.id,
        schema_name: detail.name,
        compiled: detail.source.is_compiled(),
        rule_count: detail.algebra.len(),
        groups: qieyun_kit::fuzzy::FuzzyGroup::ALL
            .iter()
            .map(|g| FuzzyGroupDto {
                id: g.id().to_string(),
                label: g.label().to_string(),
                rules: g.rules().iter().map(|r| r.to_string()).collect(),
                enabled: enabled.contains(g),
            })
            .collect(),
    })
}

/// 应用模糊音：从编译产物取原始 algebra → 剥离旧规则 → 按选择重建，写入 `<schema>.custom.yaml`。
#[tauri::command(rename_all = "snake_case")]
pub fn apply_fuzzy_settings(schema_id: String, groups: Vec<String>) -> Result<WriteDto, String> {
    use qieyun_kit::fuzzy::{self, FuzzyGroup};

    let parsed: Vec<FuzzyGroup> = groups
        .iter()
        .map(|id| FuzzyGroup::from_id(id).ok_or_else(|| format!("未知的模糊音组：{id}")))
        .collect::<Result<_, _>>()?;

    let ctx = Ctx::resolve();
    let shared = env::detect_shared_dir(&env::shared_dir_candidates());
    let detail =
        qieyun_kit::detail::read_schema_detail(&ctx.user_dir, shared.as_deref(), &schema_id);
    if detail.algebra.is_empty() {
        return Err(format!(
            "读不到方案 {schema_id} 的 speller/algebra——请先在输入法里部署一次，或确认方案已安装。"
        ));
    }

    let algebra = fuzzy::build(&detail.algebra, &parsed);
    let value = serde_yaml::to_value(&algebra).map_err(|e| e.to_string())?;

    let mut files = BTreeMap::new();
    files.insert(
        format!("{schema_id}.custom.yaml"),
        vec![Edit::set("speller/algebra", value)],
    );

    let ws = Workspace::new(&ctx.user_dir);
    let outcome = ws
        .write_patch(&files, Some("修改模糊音"))
        .map_err(|e| e.to_string())?;
    Ok(WriteDto {
        written_files: outcome.written_files,
    })
}

#[cfg(test)]
mod fuzzy_dto_tests {
    #[test]
    fn fuzzy_group_ids_match_backend_contract() {
        for g in qieyun_kit::fuzzy::FuzzyGroup::ALL {
            assert!(!g.id().is_empty());
            assert!(!g.rules().is_empty());
        }
    }
}
