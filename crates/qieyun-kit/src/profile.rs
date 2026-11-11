//! 只读探查用户的 Rime 配置：方案列表、方案显示名、主题、GUI 可写文件清单。
//!
//! 这里实现的是 Rime 配置语义的一个**最小子集**，只为了 GUI 的"概览/方案/外观"页有真数据：
//! - `schema_list` 取共享 `default.yaml`，再用用户 `default.custom.yaml` 的 patch 覆盖；
//! - 方案显示名读 `<id>.schema.yaml` 的 `schema/name`（用户目录优先，再共享目录）；
//! - 主题读 `squirrel.custom.yaml` / `weasel.custom.yaml` 的 `patch`。
//!
//! 完整的 patch 语义（`__include`、嵌套 merge）留给内置 librime 处理，不在这里重造。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SchemaEntry {
    pub id: String,
    pub name: String,
    /// 是否出现在当前 `schema_list` 中。
    pub enabled: bool,
    /// 用户目录里是否存在 `<id>.custom.yaml`。
    pub has_custom: bool,
    /// 是否双拼类方案（id 前缀或显示名判定）。
    pub is_shuangpin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    pub user_dir: PathBuf,
    pub shared_dir: Option<PathBuf>,
    pub schemas: Vec<SchemaEntry>,
    pub default_schema: Option<String>,
    pub themes: Vec<String>,
    pub current_theme: Option<String>,
    /// 用户目录下的 `*.custom.yaml`（GUI 的写入面）。
    pub custom_files: Vec<String>,
}

/// 扫描用户配置。目录不存在时返回空 profile 而不是报错（首启引导需要这个语义）。
pub fn scan(user_dir: &Path, shared_dir: Option<&Path>) -> Profile {
    let ids = schema_list(user_dir, shared_dir);
    let all_ids = discover_schema_ids(user_dir, shared_dir, &ids);

    let schemas = all_ids
        .into_iter()
        .map(|id| {
            let name = schema_name(&id, user_dir, shared_dir).unwrap_or_else(|| id.clone());
            let is_shuangpin = id.starts_with("double_pinyin") || name.contains("双拼");
            SchemaEntry {
                enabled: ids.contains(&id),
                has_custom: user_dir.join(format!("{id}.custom.yaml")).is_file(),
                is_shuangpin,
                name,
                id,
            }
        })
        .collect();

    let (themes, current_theme) = themes(user_dir);

    Profile {
        user_dir: user_dir.to_path_buf(),
        shared_dir: shared_dir.map(Path::to_path_buf),
        schemas,
        default_schema: ids.first().cloned(),
        themes,
        current_theme,
        custom_files: list_custom_files(user_dir),
    }
}

fn read_yaml(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_yaml::from_str(&text).ok()
}

/// `schema_list` → 方案 id 列表（已应用用户 patch）。
pub fn schema_list(user_dir: &Path, shared_dir: Option<&Path>) -> Vec<String> {
    // plum（东风破）会把方案直接装进用户目录，此时没有独立的共享目录，
    // 所以 `default.yaml` 要先看共享目录，再退回用户目录。
    let shared = shared_dir
        .map(|d| d.join("default.yaml"))
        .and_then(|p| read_yaml(&p))
        .or_else(|| read_yaml(&user_dir.join("default.yaml")));
    let patched = read_yaml(&user_dir.join("default.custom.yaml"))
        .and_then(|v| v.get("patch").and_then(|p| p.get("schema_list")).cloned());

    let source = patched.or(shared.and_then(|v| v.get("schema_list").cloned()));
    parse_schema_list(source.as_ref())
}

fn parse_schema_list(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Sequence(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| match item {
            Value::Mapping(map) => map
                .get(Value::String("schema".into()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            Value::String(s) => Some(s.clone()),
            _ => None,
        })
        .collect()
}

/// 已知方案 = 当前启用的 + 用户/共享目录里能找到的 `<id>.schema.yaml`。
fn discover_schema_ids(
    user_dir: &Path,
    shared_dir: Option<&Path>,
    enabled: &[String],
) -> Vec<String> {
    let mut ids: Vec<String> = enabled.to_vec();
    for dir in std::iter::once(user_dir).chain(shared_dir) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = name.strip_suffix(".schema.yaml") {
                if !ids.iter().any(|existing| existing == id) {
                    ids.push(id.to_string());
                }
            }
        }
    }
    ids
}

/// 读方案的显示名：用户目录的 `<id>.schema.yaml` 优先，其次共享目录。
pub fn schema_name(id: &str, user_dir: &Path, shared_dir: Option<&Path>) -> Option<String> {
    let file = format!("{id}.schema.yaml");
    let candidates = std::iter::once(user_dir.join(&file)).chain(shared_dir.map(|d| d.join(&file)));
    for path in candidates {
        if let Some(name) = read_yaml(&path).and_then(|v| {
            v.get("schema")
                .and_then(|s| s.get("name"))
                .and_then(|n| n.as_str())
                .map(str::to_string)
        }) {
            return Some(name);
        }
    }
    None
}

/// 主题列表与当前主题（来自 GUI 拥有的样式文件）。
pub fn themes(user_dir: &Path) -> (Vec<String>, Option<String>) {
    let mut names = Vec::new();
    let mut current = None;
    for file in ["squirrel.custom.yaml", "weasel.custom.yaml"] {
        let Some(root) = read_yaml(&user_dir.join(file)) else {
            continue;
        };
        let Some(patch) = root.get("patch") else {
            continue;
        };
        if let Value::Mapping(map) = patch {
            // 两种写法都要支持：嵌套映射 `preset_color_schemes:\n  a: {...}`
            // 与 Rime patch 惯用的斜杠平铺键 `preset_color_schemes/a: {...}`。
            for (key, value) in map {
                let Some(key) = key.as_str() else { continue };
                if key == "preset_color_schemes" {
                    if let Value::Mapping(inner) = value {
                        for name in inner.keys().filter_map(|k| k.as_str()) {
                            if !names.iter().any(|n: &String| n == name) {
                                names.push(name.to_string());
                            }
                        }
                    }
                } else if let Some(rest) = key.strip_prefix("preset_color_schemes/") {
                    let name = rest.split('/').next().unwrap_or(rest);
                    if !names.iter().any(|n: &String| n == name) {
                        names.push(name.to_string());
                    }
                }
            }
        }
        if current.is_none() {
            current = patch
                .get("style/color_scheme")
                .and_then(|v| v.as_str())
                .map(str::to_string);
        }
    }
    names.sort();
    (names, current)
}

fn list_custom_files(user_dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".custom.yaml") && entry.path().is_file() {
                out.push(name);
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "qieyun-profile-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        let user = root.join("user");
        let shared = root.join("shared");
        std::fs::create_dir_all(&user).unwrap();
        std::fs::create_dir_all(&shared).unwrap();

        std::fs::write(
            shared.join("default.yaml"),
            "schema_list:\n  - schema: rime_ice   # 雾凇\n  - schema: double_pinyin_flypy\n",
        )
        .unwrap();
        std::fs::write(
            shared.join("rime_ice.schema.yaml"),
            "schema:\n  schema_id: rime_ice\n  name: 雾凇拼音\n",
        )
        .unwrap();
        std::fs::write(
            shared.join("double_pinyin_flypy.schema.yaml"),
            "schema:\n  name: 小鹤双拼\n",
        )
        .unwrap();
        std::fs::write(
            shared.join("luna_pinyin.schema.yaml"),
            "schema:\n  name: 朙月拼音\n",
        )
        .unwrap();
        std::fs::write(
            user.join("squirrel.custom.yaml"),
            "patch:\n  style/color_scheme: qieyun_dark\n  preset_color_schemes/qieyun_dark:\n    back_color: 0xFF1E1E1E\n  preset_color_schemes/paper:\n    back_color: 0xFFF5F0E6\n",
        )
        .unwrap();
        std::fs::write(user.join("rime_ice.custom.yaml"), "patch:\n  a: 1\n").unwrap();
        (user, shared)
    }

    #[test]
    fn scans_schema_list_and_names() {
        let (user, shared) = fixture();
        let p = scan(&user, Some(&shared));
        assert_eq!(p.default_schema.as_deref(), Some("rime_ice"));
        assert_eq!(p.schemas[0].name, "雾凇拼音");
        assert!(p.schemas[0].enabled);
        assert!(p.schemas[0].has_custom);
        // 未启用的方案也要能列出来（方案页要能"启用它"）
        assert!(p
            .schemas
            .iter()
            .any(|s| s.id == "luna_pinyin" && !s.enabled));
        assert!(p
            .schemas
            .iter()
            .any(|s| s.id == "double_pinyin_flypy" && s.name == "小鹤双拼"));
    }

    #[test]
    fn user_patch_overrides_schema_list() {
        let (user, shared) = fixture();
        std::fs::write(
            user.join("default.custom.yaml"),
            "patch:\n  schema_list:\n    - schema: luna_pinyin\n",
        )
        .unwrap();
        let p = scan(&user, Some(&shared));
        assert_eq!(p.default_schema.as_deref(), Some("luna_pinyin"));
        assert_eq!(p.schemas.iter().filter(|s| s.enabled).count(), 1);
        assert!(p.custom_files.contains(&"default.custom.yaml".to_string()));
    }

    #[test]
    fn reads_themes_and_current() {
        let (user, shared) = fixture();
        let p = scan(&user, Some(&shared));
        assert_eq!(
            p.themes,
            vec!["paper".to_string(), "qieyun_dark".to_string()]
        );
        assert_eq!(p.current_theme.as_deref(), Some("qieyun_dark"));
    }

    #[test]
    fn falls_back_to_user_dir_default_yaml() {
        let (user, _shared) = fixture();
        std::fs::write(
            user.join("default.yaml"),
            "schema_list:\n  - schema: luna_pinyin\n",
        )
        .unwrap();
        let p = scan(&user, None);
        assert_eq!(p.default_schema.as_deref(), Some("luna_pinyin"));
        assert_eq!(p.schemas.iter().filter(|s| s.enabled).count(), 1);
    }

    #[test]
    fn missing_dirs_return_empty_profile() {
        let p = scan(Path::new("/nonexistent/qieyun-user-dir"), None);
        assert!(p.schemas.is_empty());
        assert!(p.themes.is_empty());
        assert!(p.default_schema.is_none());
    }
}
