//! 配置体检：把所有"能机器判断"的坑一次列出来。
//!
//! 设计原则：每条检查都必须给出**可执行的下一条动作**（hint），
//! 并且区分"致命（Fail）"与"提醒（Warn）"——不能让用户面对一片红。

use std::path::Path;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::detail::{read_schema_detail, DetailSource};
use crate::manifest::State;
use crate::profile;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Check {
    pub id: String,
    pub title: String,
    pub status: CheckStatus,
    pub detail: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiagnosticsReport {
    pub checks: Vec<Check>,
    pub ok: usize,
    pub warn: usize,
    pub fail: usize,
}

impl DiagnosticsReport {
    fn push(&mut self, check: Check) {
        match check.status {
            CheckStatus::Ok => self.ok += 1,
            CheckStatus::Warn => self.warn += 1,
            CheckStatus::Fail => self.fail += 1,
        }
        self.checks.push(check);
    }
}

fn check(id: &str, title: &str, status: CheckStatus, detail: String, hint: Option<&str>) -> Check {
    Check {
        id: id.to_string(),
        title: title.to_string(),
        status,
        detail,
        hint: hint.map(str::to_string),
    }
}

/// 跑一遍体检。目录不存在时也会返回完整报告（而不是报错）。
pub fn run(user_dir: &Path, shared_dir: Option<&Path>) -> DiagnosticsReport {
    let mut report = DiagnosticsReport::default();

    // 1. 用户目录
    if user_dir.is_dir() {
        report.push(check(
            "user-dir",
            "Rime 用户目录",
            CheckStatus::Ok,
            user_dir.display().to_string(),
            None,
        ));
    } else {
        report.push(check(
            "user-dir",
            "Rime 用户目录",
            CheckStatus::Fail,
            format!("不存在：{}", user_dir.display()),
            Some("确认输入法是否安装过，或在设置里切换用户目录。"),
        ));
        return report;
    }

    // 2. installation.yaml
    match crate::env::read_installation(user_dir) {
        Some(meta) => report.push(check(
            "installation",
            "安装信息 installation.yaml",
            CheckStatus::Ok,
            format!(
                "{} {} · Rime {} · id {}",
                meta.distribution_name.as_deref().unwrap_or("-"),
                meta.distribution_version.as_deref().unwrap_or(""),
                meta.rime_version.as_deref().unwrap_or("-"),
                meta.installation_id.as_deref().unwrap_or("-")
            ),
            None,
        )),
        None => report.push(check(
            "installation",
            "安装信息 installation.yaml",
            CheckStatus::Warn,
            "缺失或无法解析".to_string(),
            Some("缺这个文件不影响输入，但同步/部署记录会缺失；重装输入法可生成。"),
        )),
    }

    // 3. schema_list
    let schemas = profile::schema_list(user_dir, shared_dir);
    if schemas.is_empty() {
        report.push(check(
            "schema-list",
            "方案列表 schema_list",
            CheckStatus::Fail,
            "没有可用的方案列表".to_string(),
            Some("在「方案与启用」里启用至少一个方案，或检查 default.yaml。"),
        ));
    } else {
        report.push(check(
            "schema-list",
            "方案列表 schema_list",
            CheckStatus::Ok,
            format!("已启用 {} 个方案，默认 {}", schemas.len(), schemas[0]),
            None,
        ));
    }

    // 4. 方案文件是否齐全
    let missing: Vec<&String> = schemas
        .iter()
        .filter(|id| {
            matches!(
                read_schema_detail(user_dir, shared_dir, id).source,
                DetailSource::Missing
            )
        })
        .collect();
    if missing.is_empty() {
        report.push(check(
            "schema-files",
            "方案文件完整性",
            CheckStatus::Ok,
            format!("{} 个方案的定义文件都能找到", schemas.len()),
            None,
        ));
    } else {
        report.push(check(
            "schema-files",
            "方案文件完整性",
            CheckStatus::Fail,
            format!(
                "找不到这些方案的定义文件：{}",
                missing
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join("、")
            ),
            Some("在「方案与启用」里停用它们，或重新安装对应方案。"),
        ));
    }

    // 5. custom 文件能否解析
    let mut bad_custom = Vec::new();
    if let Ok(entries) = std::fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".custom.yaml") {
                continue;
            }
            let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
            if !text.trim().is_empty() && serde_yaml::from_str::<serde_yaml::Value>(&text).is_err()
            {
                bad_custom.push(name);
            }
        }
    }
    if bad_custom.is_empty() {
        report.push(check(
            "custom-parse",
            "custom 配置语法",
            CheckStatus::Ok,
            "所有 *.custom.yaml 都能解析".to_string(),
            None,
        ));
    } else {
        report.push(check(
            "custom-parse",
            "custom 配置语法",
            CheckStatus::Fail,
            format!("这些文件不是合法 YAML：{}", bad_custom.join("、")),
            Some("在「高级」页打开原始文件修正，或从快照回滚。"),
        ));
    }

    // 6. build 产物
    let artifacts = count_build_artifacts(&user_dir.join("build"));
    if artifacts == 0 {
        report.push(check(
            "build",
            "编译产物 build/",
            CheckStatus::Warn,
            "还没有编译产物".to_string(),
            Some("点一次「保存并部署」，或触发输入法的重新部署。"),
        ));
    } else {
        report.push(check(
            "build",
            "编译产物 build/",
            CheckStatus::Ok,
            format!("{artifacts} 个产物"),
            None,
        ));
    }

    // 7. 新鲜度：源配置是否比产物新
    let newest_source = newest_mtime(user_dir, |name| {
        name.ends_with(".yaml") || name.ends_with(".txt")
    });
    let newest_build = newest_mtime(&user_dir.join("build"), |name| {
        name.ends_with(".yaml") || name.ends_with(".bin")
    });
    match (newest_source, newest_build) {
        (Some(src), Some(build)) if src > build + std::time::Duration::from_secs(1) => {
            report.push(check(
                "stale-build",
                "配置与产物一致性",
                CheckStatus::Warn,
                "配置文件比编译产物新，改动可能尚未生效".to_string(),
                Some("点一次「保存并部署」（或输入法菜单里的「重新部署」）。"),
            ));
        }
        (Some(_), Some(_)) => report.push(check(
            "stale-build",
            "配置与产物一致性",
            CheckStatus::Ok,
            "产物不旧于配置".to_string(),
            None,
        )),
        _ => report.push(check(
            "stale-build",
            "配置与产物一致性",
            CheckStatus::Ok,
            "无法比较（缺一侧的时间戳）".to_string(),
            None,
        )),
    }

    // 8. 托管键是否还在（漂移/丢失）
    let state_path = user_dir.join(crate::workspace::META_DIR).join("state.json");
    match State::load(&state_path) {
        Ok(state) if state.files.is_empty() && !state_path.is_file() => report.push(check(
            "managed-keys",
            "托管键状态",
            CheckStatus::Warn,
            "尚未接管（没有 .qieyun/state.json）".to_string(),
            Some("在「概览」页完成一次「备份并接管」。"),
        )),
        Ok(state) => {
            let mut missing_keys = Vec::new();
            let mut drifted = Vec::new();
            for file in state.files.keys() {
                let text = std::fs::read_to_string(user_dir.join(file)).unwrap_or_default();
                for d in state.detect_drift(file, &text) {
                    match d {
                        crate::manifest::Drift::Missing { key } => {
                            missing_keys.push(format!("{file}:{key}"))
                        }
                        crate::manifest::Drift::Modified { key, .. } => {
                            drifted.push(format!("{file}:{key}"))
                        }
                    }
                }
            }
            if missing_keys.is_empty() && drifted.is_empty() {
                report.push(check(
                    "managed-keys",
                    "托管键状态",
                    CheckStatus::Ok,
                    format!("{} 个文件受管理，没有漂移", state.files.len()),
                    None,
                ));
            } else {
                let mut parts = Vec::new();
                if !drifted.is_empty() {
                    parts.push(format!("被手动改过：{}", drifted.join("、")));
                }
                if !missing_keys.is_empty() {
                    parts.push(format!("已被删除：{}", missing_keys.join("、")));
                }
                report.push(check(
                    "managed-keys",
                    "托管键状态",
                    CheckStatus::Warn,
                    parts.join("；"),
                    Some("这些键的后续修改会被 GUI 拒绝（防覆盖）；可在对应页面重新保存以接管。"),
                ));
            }
        }
        Err(e) => report.push(check(
            "managed-keys",
            "托管键状态",
            CheckStatus::Fail,
            format!("状态文件损坏：{e}"),
            Some("删除 .qieyun/state.json 后重新接管（会丢失托管记录，但不动你的配置）。"),
        )),
    }

    // 9. 部署锁残留
    let lock = user_dir
        .join(crate::workspace::META_DIR)
        .join("deploy.lock");
    if lock.is_file() {
        report.push(check(
            "deploy-lock",
            "部署锁",
            CheckStatus::Warn,
            format!("存在锁文件：{}", lock.display()),
            Some("若确认没有部署在进行，删除该文件即可。"),
        ));
    } else {
        report.push(check(
            "deploy-lock",
            "部署锁",
            CheckStatus::Ok,
            "无残留锁".to_string(),
            None,
        ));
    }

    // 10. 共享目录（信息性）
    match shared_dir {
        Some(dir) => report.push(check(
            "shared-dir",
            "共享目录",
            CheckStatus::Ok,
            dir.display().to_string(),
            None,
        )),
        None => report.push(check(
            "shared-dir",
            "共享目录",
            CheckStatus::Ok,
            "未发现独立共享目录（plum 安装方式会把方案直接装进用户目录，属正常）".to_string(),
            None,
        )),
    }

    report
}

fn count_build_artifacts(build: &Path) -> usize {
    std::fs::read_dir(build)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().to_string();
                    n.ends_with(".bin") || n.ends_with(".schema.yaml")
                })
                .count()
        })
        .unwrap_or(0)
}

fn newest_mtime(dir: &Path, accept: impl Fn(&str) -> bool) -> Option<SystemTime> {
    let mut newest: Option<SystemTime> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !accept(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        if let Ok(mtime) = meta.modified() {
            newest = Some(match newest {
                Some(cur) if cur > mtime => cur,
                _ => mtime,
            });
        }
    }
    newest
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn tmp(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-diag-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn set_mtime(path: &Path, when: SystemTime) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_times(std::fs::FileTimes::new().set_modified(when))
            .unwrap();
    }

    fn healthy(tag: &str) -> std::path::PathBuf {
        let user = tmp(tag);
        std::fs::create_dir_all(user.join("build")).unwrap();
        std::fs::write(
            user.join("installation.yaml"),
            "distribution_name: 鼠鬚管\nrime_version: 1.11.2\n",
        )
        .unwrap();
        std::fs::write(
            user.join("default.custom.yaml"),
            "patch:\n  schema_list:\n    - schema: rime_ice\n",
        )
        .unwrap();
        std::fs::write(
            user.join("rime_ice.schema.yaml"),
            "schema:\n  name: 雾凇拼音\nspeller:\n  algebra: []\n",
        )
        .unwrap();
        std::fs::write(
            user.join("build/rime_ice.schema.yaml"),
            "schema:\n  name: x\n",
        )
        .unwrap();
        std::fs::write(user.join("build/rime_ice.prism.bin"), "b").unwrap();

        // 让产物比源文件新，避免误报 stale
        let now = SystemTime::now();
        set_mtime(
            &user.join("default.custom.yaml"),
            now - Duration::from_secs(7200),
        );
        set_mtime(
            &user.join("rime_ice.schema.yaml"),
            now - Duration::from_secs(7200),
        );
        set_mtime(
            &user.join("installation.yaml"),
            now - Duration::from_secs(7200),
        );
        user
    }

    fn find<'a>(r: &'a DiagnosticsReport, id: &str) -> &'a Check {
        r.checks
            .iter()
            .find(|c| c.id == id)
            .unwrap_or_else(|| panic!("缺少检查项 {id}"))
    }

    #[test]
    fn healthy_profile_has_no_failures() {
        let user = healthy("ok");
        let report = run(&user, None);
        assert_eq!(report.fail, 0, "{:#?}", report.checks);
        // 尚未接管 → 至少有一条 warn
        assert!(report.warn >= 1);
        assert_eq!(find(&report, "schema-list").status, CheckStatus::Ok);
        assert_eq!(find(&report, "schema-files").status, CheckStatus::Ok);
        assert_eq!(find(&report, "stale-build").status, CheckStatus::Ok);
    }

    #[test]
    fn missing_user_dir_is_fatal() {
        let report = run(Path::new("/nonexistent/qieyun-user"), None);
        assert_eq!(report.fail, 1);
        assert_eq!(find(&report, "user-dir").status, CheckStatus::Fail);
    }

    #[test]
    fn missing_schema_file_is_reported() {
        let user = healthy("missing-schema");
        std::fs::write(
            user.join("default.custom.yaml"),
            "patch:\n  schema_list:\n    - schema: rime_ice\n    - schema: ghost\n",
        )
        .unwrap();
        let report = run(&user, None);
        let c = find(&report, "schema-files");
        assert_eq!(c.status, CheckStatus::Fail);
        assert!(c.detail.contains("ghost"), "{}", c.detail);
    }

    #[test]
    fn broken_custom_yaml_is_reported() {
        let user = healthy("broken");
        std::fs::write(user.join("bad.custom.yaml"), "patch: [\n").unwrap();
        let report = run(&user, None);
        let c = find(&report, "custom-parse");
        assert_eq!(c.status, CheckStatus::Fail);
        assert!(c.detail.contains("bad.custom.yaml"));
    }

    #[test]
    fn stale_build_is_reported() {
        let user = healthy("stale");
        // 产物固定为两小时前，源文件改成"刚刚修改"
        let now = SystemTime::now();
        set_mtime(
            &user.join("build/rime_ice.schema.yaml"),
            now - Duration::from_secs(7200),
        );
        set_mtime(
            &user.join("build/rime_ice.prism.bin"),
            now - Duration::from_secs(7200),
        );
        set_mtime(&user.join("default.custom.yaml"), now);
        let report = run(&user, None);
        assert_eq!(find(&report, "stale-build").status, CheckStatus::Warn);
    }

    #[test]
    fn managed_key_drift_is_reported() {
        let user = healthy("drift");
        // 建立托管记录：先写入再手改
        let ws = crate::workspace::Workspace::new(&user);
        let mut state = State::default();
        let text = "patch:\n  style/font_point: 14\n";
        std::fs::write(user.join("squirrel.custom.yaml"), text).unwrap();
        state.record("squirrel.custom.yaml", "style/font_point", text, "t");
        state.save(&ws.state_path()).unwrap();

        std::fs::write(
            user.join("squirrel.custom.yaml"),
            "patch:\n  style/font_point: 20\n",
        )
        .unwrap();

        let report = run(&user, None);
        let c = find(&report, "managed-keys");
        assert_eq!(c.status, CheckStatus::Warn);
        assert!(c.detail.contains("style/font_point"), "{}", c.detail);
    }
}
