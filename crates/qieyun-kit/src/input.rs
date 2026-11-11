//! 输入方案与按键设置：`default.custom.yaml` 里 GUI 负责的三个键。
//!
//! - `schema_list`：方案启用与顺序（第一项即默认方案）
//! - `menu/page_size`：候选数量
//! - `key_binder/bindings`：翻页键与中英切换热键
//!
//! 关键取舍：`key_binder/bindings` 是**用户可能自己写过**的区域。这里采用
//! "只替换自己那一批"的策略——按 `accept` 键识别哪些行归 GUI 管，
//! 其余行（如用户自己绑的 emoji、简繁热键）原样保留。

use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};

use crate::patch::Edit;

/// 翻页键风格。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageKeys {
    /// `,` / `.`
    CommaPeriod,
    /// `[` / `]`
    Bracket,
    /// PageUp / PageDown（部分外接键盘习惯）
    PageUpDown,
    /// 不生成翻页绑定（沿用方案自带）
    Off,
}

impl PageKeys {
    /// (上一页 accept, 下一页 accept)
    fn accepts(self) -> Option<(&'static str, &'static str)> {
        match self {
            PageKeys::CommaPeriod => Some(("comma", "period")),
            PageKeys::Bracket => Some(("bracketleft", "bracketright")),
            PageKeys::PageUpDown => Some(("Page_Up", "Page_Down")),
            PageKeys::Off => None,
        }
    }
}

/// 中英切换热键。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AsciiToggleKey {
    /// `Control+Shift+space`（Rime 社区常用）
    ControlShiftSpace,
    /// 单独按左 Shift
    ShiftLeft,
    /// 不绑定
    Off,
}

impl AsciiToggleKey {
    fn accept(self) -> Option<&'static str> {
        match self {
            AsciiToggleKey::ControlShiftSpace => Some("Control+Shift+space"),
            AsciiToggleKey::ShiftLeft => Some("Shift_L"),
            AsciiToggleKey::Off => None,
        }
    }
}

/// 一整套输入设置。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputSettings {
    /// 启用方案，顺序即 `schema_list` 顺序，首个为默认。
    pub schema_list: Vec<String>,
    /// 候选数量（3–10）。
    pub page_size: u8,
    pub page_keys: PageKeys,
    pub toggle_ascii: AsciiToggleKey,
}

impl Default for InputSettings {
    fn default() -> Self {
        InputSettings {
            schema_list: Vec::new(),
            page_size: 7,
            page_keys: PageKeys::CommaPeriod,
            toggle_ascii: AsciiToggleKey::ControlShiftSpace,
        }
    }
}

/// GUI 管哪些 `accept`：这些行会被替换，其余保留。
const MANAGED_ACCEPTS: &[&str] = &[
    "comma",
    "period",
    "bracketleft",
    "bracketright",
    "Page_Up",
    "Page_Down",
    "Control+Shift+space",
    "Shift_L",
];

impl InputSettings {
    /// 从已解析的 `default.custom.yaml` 读取（缺失字段用默认值）。
    pub fn from_yaml(root: &Value) -> Self {
        let patch = root.get("patch");
        let mut settings = InputSettings::default();

        if let Some(Value::Sequence(items)) = patch.and_then(|p| p.get("schema_list")) {
            settings.schema_list = items
                .iter()
                .filter_map(|item| match item {
                    Value::Mapping(map) => map
                        .get(Value::String("schema".into()))
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    Value::String(s) => Some(s.clone()),
                    _ => None,
                })
                .collect();
        }

        if let Some(size) = patch
            .and_then(|p| p.get("menu/page_size"))
            .and_then(|v| v.as_u64())
        {
            settings.page_size = size.clamp(3, 10) as u8;
        }

        if let Some(Value::Sequence(bindings)) = patch.and_then(|p| p.get("key_binder/bindings")) {
            for row in bindings {
                let Some(map) = row.as_mapping() else {
                    continue;
                };
                let accept = map
                    .get(Value::String("accept".into()))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                match accept {
                    "comma" | "bracketleft" | "Page_Up" => {
                        settings.page_keys = match accept {
                            "comma" => PageKeys::CommaPeriod,
                            "bracketleft" => PageKeys::Bracket,
                            _ => PageKeys::PageUpDown,
                        };
                    }
                    "Control+Shift+space" => {
                        settings.toggle_ascii = AsciiToggleKey::ControlShiftSpace
                    }
                    "Shift_L" => settings.toggle_ascii = AsciiToggleKey::ShiftLeft,
                    _ => {}
                }
            }
        }

        settings
    }

    /// 生成写入 `default.custom.yaml` 的编辑；`existing` 是同一份文件解析后的根，
    /// 用来保留用户自己写的其它按键绑定。
    pub fn edits(&self, existing: &Value) -> Vec<Edit> {
        let mut out = Vec::new();

        let schema_seq = Value::Sequence(
            self.schema_list
                .iter()
                .map(|id| {
                    let mut map = Mapping::new();
                    map.insert(Value::String("schema".into()), Value::String(id.clone()));
                    Value::Mapping(map)
                })
                .collect(),
        );
        out.push(Edit::set("schema_list", schema_seq));
        out.push(Edit::set(
            "menu/page_size",
            Value::from(self.page_size as u64),
        ));

        // 保留用户自己的绑定，只替换 GUI 管的那批
        let mut kept: Vec<Value> = existing
            .get("patch")
            .and_then(|p| p.get("key_binder/bindings"))
            .and_then(|v| v.as_sequence())
            .map(|rows| {
                rows.iter()
                    .filter(|row| {
                        let accept = row
                            .as_mapping()
                            .and_then(|m| m.get(Value::String("accept".into())))
                            .and_then(|v| v.as_str())
                            .unwrap_or_default();
                        !MANAGED_ACCEPTS.contains(&accept)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();

        let mut ours: Vec<Value> = Vec::new();
        if let Some((up, down)) = self.page_keys.accepts() {
            ours.push(binding(&[
                ("when", "paging"),
                ("accept", up),
                ("send", "Page_Up"),
            ]));
            ours.push(binding(&[
                ("when", "has_menu"),
                ("accept", down),
                ("send", "Page_Down"),
            ]));
        }
        if let Some(accept) = self.toggle_ascii.accept() {
            ours.push(binding(&[
                ("when", "always"),
                ("accept", accept),
                ("toggle", "ascii_mode"),
            ]));
        }
        kept.extend(ours);
        out.push(Edit::set("key_binder/bindings", Value::Sequence(kept)));

        out
    }
}

fn binding(pairs: &[(&str, &str)]) -> Value {
    let mut map = Mapping::new();
    for (key, value) in pairs {
        map.insert(
            Value::String((*key).to_string()),
            Value::String((*value).to_string()),
        );
    }
    Value::Mapping(map)
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SettingsError {
    #[error("至少要启用一个方案，否则输入法没有可用的方案")]
    EmptySchemaList,
    #[error("候选数量必须在 3–10 之间，当前是 {0}")]
    PageSizeOutOfRange(u8),
    #[error("方案列表里有重复项：{0}")]
    DuplicateSchema(String),
}

impl InputSettings {
    /// 写入前的硬校验。前端也会拦，但后端不能依赖前端。
    pub fn validate(&self) -> Result<(), SettingsError> {
        if self.schema_list.is_empty() {
            return Err(SettingsError::EmptySchemaList);
        }
        if !(3..=10).contains(&self.page_size) {
            return Err(SettingsError::PageSizeOutOfRange(self.page_size));
        }
        let mut seen = std::collections::HashSet::new();
        for id in &self.schema_list {
            if !seen.insert(id) {
                return Err(SettingsError::DuplicateSchema(id.clone()));
            }
        }
        Ok(())
    }
}

/// Rime 键名 → 展示文案（前端/日志用）。
pub fn page_key_label(keys: PageKeys) -> &'static str {
    match keys {
        PageKeys::CommaPeriod => "逗号 / 句号",
        PageKeys::Bracket => "左方括号 / 右方括号",
        PageKeys::PageUpDown => "PageUp / PageDown",
        PageKeys::Off => "不设置",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::{apply_edits, CreatePolicy};

    const EXISTING: &str = "\
patch:
  # 用户自己的绑定，必须保留
  key_binder/bindings:
    - {accept: \"Control+Shift+E\", toggle: emoji_suggestion, when: always}
    - {accept: comma, send: Page_Up, when: paging}
  menu/page_size: 5
";

    fn parse(s: &str) -> Value {
        serde_yaml::from_str(s).unwrap()
    }

    #[test]
    fn reads_settings_from_custom_yaml() {
        let root = parse(
            "patch:\n  schema_list:\n    - schema: rime_ice\n    - schema: luna_pinyin\n  menu/page_size: 9\n  key_binder/bindings:\n    - {accept: bracketleft, send: Page_Up, when: paging}\n    - {accept: Shift_L, toggle: ascii_mode, when: always}\n",
        );
        let s = InputSettings::from_yaml(&root);
        assert_eq!(s.schema_list, vec!["rime_ice", "luna_pinyin"]);
        assert_eq!(s.page_size, 9);
        assert_eq!(s.page_keys, PageKeys::Bracket);
        assert_eq!(s.toggle_ascii, AsciiToggleKey::ShiftLeft);
    }

    #[test]
    fn defaults_when_missing() {
        let s = InputSettings::from_yaml(&parse("{}"));
        assert!(s.schema_list.is_empty());
        assert_eq!(s.page_size, 7);
        assert_eq!(s.page_keys, PageKeys::CommaPeriod);
    }

    #[test]
    fn keeps_user_bindings_and_replaces_managed_ones() {
        let existing = parse(EXISTING);
        let settings = InputSettings {
            schema_list: vec!["rime_ice".into(), "double_pinyin_flypy".into()],
            page_size: 6,
            page_keys: PageKeys::Bracket,
            toggle_ascii: AsciiToggleKey::ShiftLeft,
        };
        let out = apply_edits(EXISTING, &settings.edits(&existing), CreatePolicy::Reject).unwrap();

        // 用户那行 emoji 保留
        assert!(out.contains("Control+Shift+E"), "{out}");
        // 旧的逗号翻页被替换成方括号
        assert!(out.contains("accept: bracketleft"), "{out}");
        assert!(!out.contains("accept: comma"), "{out}");
        // 新的中英切换
        assert!(out.contains("accept: Shift_L"), "{out}");
        assert!(out.contains("toggle: ascii_mode"), "{out}");
        // schema_list 与候选数
        assert!(out.contains("schema_list:"), "{out}");
        assert!(out.contains("- schema: rime_ice"), "{out}");
        assert!(out.contains("page_size: 6"), "{out}");

        // 生成物必须是合法 YAML
        let root = parse(&out);
        let patch = root.get("patch").unwrap();
        assert_eq!(
            patch.get("menu/page_size").and_then(|v| v.as_u64()),
            Some(6)
        );
        assert_eq!(
            patch
                .get("schema_list")
                .and_then(|v| v.as_sequence())
                .map(|s| s.len()),
            Some(2)
        );
    }

    #[test]
    fn idempotent() {
        let existing = parse(EXISTING);
        let settings = InputSettings {
            schema_list: vec!["rime_ice".into()],
            page_size: 7,
            page_keys: PageKeys::CommaPeriod,
            toggle_ascii: AsciiToggleKey::ControlShiftSpace,
        };
        let once = apply_edits(EXISTING, &settings.edits(&existing), CreatePolicy::Reject).unwrap();
        let twice =
            apply_edits(&once, &settings.edits(&parse(&once)), CreatePolicy::Reject).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn validation_rejects_bad_settings() {
        let mut s = InputSettings::default();
        assert_eq!(s.validate(), Err(SettingsError::EmptySchemaList));

        s.schema_list = vec!["a".into()];
        s.page_size = 2;
        assert_eq!(s.validate(), Err(SettingsError::PageSizeOutOfRange(2)));

        s.page_size = 11;
        assert_eq!(s.validate(), Err(SettingsError::PageSizeOutOfRange(11)));

        s.page_size = 7;
        s.schema_list = vec!["a".into(), "a".into()];
        assert!(matches!(
            s.validate(),
            Err(SettingsError::DuplicateSchema(_))
        ));

        s.schema_list = vec!["a".into(), "b".into()];
        assert!(s.validate().is_ok());
    }

    #[test]
    fn off_disables_generated_rows() {
        let existing = parse("{}");
        let settings = InputSettings {
            schema_list: vec!["a".into()],
            page_size: 5,
            page_keys: PageKeys::Off,
            toggle_ascii: AsciiToggleKey::Off,
        };
        let out = apply_edits("", &settings.edits(&existing), CreatePolicy::Create).unwrap();
        assert!(!out.contains("Page_Up"), "{out}");
        assert!(!out.contains("ascii_mode"), "{out}");
        assert!(out.contains("page_size: 5"));
    }
}
