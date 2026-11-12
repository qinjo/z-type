//! 方案详情：给"双拼 / 标点 / 高级"页提供只读数据。
//!
//! 优先读编译产物 `build/<id>.schema.yaml`——它是 librime 解析完 `__include`/patch 之后的
//! 最终配置，字段最可靠；没有 build 时退回用户目录、再退回共享目录的原始 schema。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SwitchInfo {
    pub name: String,
    pub states: Vec<String>,
    pub reset: Option<i64>,
}

/// 数据来源，决定 UI 是否提示"尚未部署"。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetailSource {
    /// `build/<id>.schema.yaml`（已部署，最可靠）
    Build,
    /// 用户目录里的 `<id>.schema.yaml`
    User,
    /// 共享目录里的 `<id>.schema.yaml`
    Shared,
    Missing,
}

impl DetailSource {
    pub fn is_compiled(self) -> bool {
        matches!(self, DetailSource::Build)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchemaDetail {
    pub id: String,
    pub name: String,
    pub source: DetailSource,
    /// `speller/algebra` 的规则原文（只保留字符串项）。
    pub algebra: Vec<String>,
    /// `punctuator` 的原始结构，交给前端只读展示。
    pub punctuator: serde_json::Value,
    pub switches: Vec<SwitchInfo>,
    pub is_shuangpin: bool,
}

/// schema id 是否安全：必须是单段文件名，不能含路径分隔符或 `..`。
///
/// 审查报告 P2：`get_schema_detail(schema_id)` 的入参来自前端，未校验时 `../` 可逃出目录。
pub fn is_valid_schema_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// 解析出位置：build → user → shared。
pub fn resolve_schema_file(
    user_dir: &Path,
    shared_dir: Option<&Path>,
    id: &str,
) -> (Option<PathBuf>, DetailSource) {
    let build = user_dir.join("build").join(format!("{id}.schema.yaml"));
    if build.is_file() {
        return (Some(build), DetailSource::Build);
    }
    let user = user_dir.join(format!("{id}.schema.yaml"));
    if user.is_file() {
        return (Some(user), DetailSource::User);
    }
    if let Some(shared) = shared_dir {
        let shared_file = shared.join(format!("{id}.schema.yaml"));
        if shared_file.is_file() {
            return (Some(shared_file), DetailSource::Shared);
        }
    }
    (None, DetailSource::Missing)
}

pub fn read_schema_detail(user_dir: &Path, shared_dir: Option<&Path>, id: &str) -> SchemaDetail {
    if !is_valid_schema_id(id) {
        // 非法 id 直接当作"不存在"，绝不拼路径
        return SchemaDetail {
            id: id.to_string(),
            name: id.to_string(),
            source: DetailSource::Missing,
            algebra: Vec::new(),
            punctuator: serde_json::Value::Null,
            switches: Vec::new(),
            is_shuangpin: false,
        };
    }
    let (path, source) = resolve_schema_file(user_dir, shared_dir, id);
    let root: Option<Value> = path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_yaml::from_str::<Value>(&t).ok());

    let root_ref = root.as_ref();
    let name = root_ref
        .and_then(|r| r.get("schema"))
        .and_then(|s| s.get("name"))
        .and_then(|n| n.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| id.to_string());

    let algebra: Vec<String> = root_ref
        .and_then(|r| r.get("speller"))
        .and_then(|s| s.get("algebra"))
        .and_then(|a| a.as_sequence())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let punctuator = root_ref
        .and_then(|r| r.get("punctuator"))
        .and_then(|p| serde_json::to_value(p).ok())
        .unwrap_or(serde_json::Value::Null);

    let switches = root_ref
        .and_then(|r| r.get("switches"))
        .and_then(|s| s.as_sequence())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let name = item.get("name")?.as_str()?.to_string();
                    let states = item
                        .get("states")
                        .and_then(|s| s.as_sequence())
                        .map(|st| {
                            st.iter()
                                .map(|v| match v.as_str() {
                                    Some(s) => s.to_string(),
                                    None => serde_yaml::to_string(v)
                                        .unwrap_or_default()
                                        .trim()
                                        .to_string(),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let reset = item.get("reset").and_then(|v| v.as_i64());
                    Some(SwitchInfo {
                        name,
                        states,
                        reset,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let is_shuangpin = id.starts_with("double_pinyin")
        || name.contains("双拼")
        || algebra.iter().any(|r| r.contains("xform"));
    // 说明：用 algebra 里是否含 xform 只是辅助信号，不作为唯一判据。

    SchemaDetail {
        id: id.to_string(),
        name,
        source,
        algebra,
        punctuator,
        switches,
        is_shuangpin,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "qieyun-detail-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let user = root.join("user");
        let shared = root.join("shared");
        std::fs::create_dir_all(user.join("build")).unwrap();
        std::fs::create_dir_all(&shared).unwrap();
        std::fs::write(
            user.join("build/rime_ice.schema.yaml"),
            "schema:\n  name: 雾凇拼音\nspeller:\n  algebra:\n    - \"derive/^zh/z/\"\n    - \"abbrev/^([a-z]).+$/$1/\"\npunctuator:\n  half_shape:\n    \",\": \"，\"\nswitches:\n  - name: ascii_mode\n    reset: 0\n    states: [中文, 英文]\n",
        )
        .unwrap();
        std::fs::write(
            shared.join("luna_pinyin.schema.yaml"),
            "schema:\n  name: 朙月拼音\nspeller:\n  algebra: []\n",
        )
        .unwrap();
        (user, shared)
    }

    #[test]
    fn prefers_build_output() {
        let (user, shared) = fixture();
        let d = read_schema_detail(&user, Some(&shared), "rime_ice");
        assert_eq!(d.source, DetailSource::Build);
        assert_eq!(d.name, "雾凇拼音");
        assert_eq!(d.algebra.len(), 2);
        assert_eq!(d.switches[0].name, "ascii_mode");
        assert_eq!(d.switches[0].states, vec!["中文", "英文"]);
        assert_eq!(d.switches[0].reset, Some(0));
        assert_eq!(d.punctuator["half_shape"][","], "，");
    }

    #[test]
    fn falls_back_to_shared_and_reports_source() {
        let (user, shared) = fixture();
        let d = read_schema_detail(&user, Some(&shared), "luna_pinyin");
        assert_eq!(d.source, DetailSource::Shared);
        assert!(!d.source.is_compiled());
    }

    #[test]
    fn missing_schema_degrades_gracefully() {
        let (user, shared) = fixture();
        let d = read_schema_detail(&user, Some(&shared), "does_not_exist");
        assert_eq!(d.source, DetailSource::Missing);
        assert!(d.algebra.is_empty());
        assert!(d.switches.is_empty());
    }

    #[test]
    fn rejects_path_traversal_schema_ids() {
        for bad in ["../evil", "a/b", "..", "", "a\\b"] {
            assert!(!is_valid_schema_id(bad), "{bad} 应被判非法");
        }
        for good in ["rime_ice", "double_pinyin_flypy", "luna-pinyin"] {
            assert!(is_valid_schema_id(good), "{good} 应合法");
        }

        let (user, shared) = fixture();
        let detail = read_schema_detail(&user, Some(&shared), "../../../etc/passwd");
        assert_eq!(detail.source, DetailSource::Missing);
        assert!(detail.algebra.is_empty());
    }

    #[test]
    fn shuangpin_detection() {
        let (user, shared) = fixture();
        std::fs::write(
            shared.join("double_pinyin_flypy.schema.yaml"),
            "schema:\n  name: 小鹤双拼\n",
        )
        .unwrap();
        let d = read_schema_detail(&user, Some(&shared), "double_pinyin_flypy");
        assert!(d.is_shuangpin);
        assert!(!read_schema_detail(&user, Some(&shared), "rime_ice").is_shuangpin);
    }
}
