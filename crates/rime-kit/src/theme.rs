//! 统一主题模型与双端编译器。
//!
//! 背景（见 `docs/architecture.md` §5）：Squirrel 与 Weasel 的配色都按 **ABGR**
//! 解析（`0xAABBGGRR`），但布局字段名与位置不同。这里只维护一份 `Theme`，
//! 由 `edits(platform)` 编译成目标端 `*.custom.yaml` 里的 patch 键。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use crate::patch::Edit;
use crate::platform::Platform;

/// RGBA 颜色。对外只用这一种表示，ABGR 只在编译时出现。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn rgb(r: u8, g: u8, b: u8) -> Self {
        Rgba { r, g, b, a: 255 }
    }

    pub const fn with_alpha(r: u8, g: u8, b: u8, a: u8) -> Self {
        Rgba { r, g, b, a }
    }

    /// Rime 主题里的颜色字面量：`0xAABBGGRR`。
    pub fn to_abgr(self) -> u32 {
        ((self.a as u32) << 24) | ((self.b as u32) << 16) | ((self.g as u32) << 8) | (self.r as u32)
    }

    /// `0xFF1E1E1E` 形式的字面量，保留 alpha。
    pub fn to_abgr_literal(self) -> String {
        format!("0x{:08X}", self.to_abgr())
    }

    /// 接受 `#RRGGBB`、`#RRGGBBAA`、`RRGGBB`、`0xAABBGGRR`。
    pub fn parse(s: &str) -> Option<Self> {
        let t = s.trim().trim_start_matches('#');
        if let Some(hex) = t.strip_prefix("0x").or_else(|| t.strip_prefix("0X")) {
            let v = u32::from_str_radix(hex, 16).ok()?;
            return Some(Rgba::with_alpha(
                (v & 0xFF) as u8,
                ((v >> 8) & 0xFF) as u8,
                ((v >> 16) & 0xFF) as u8,
                ((v >> 24) & 0xFF) as u8,
            ));
        }
        let hex = t;
        match hex.len() {
            6 => {
                let v = u32::from_str_radix(hex, 16).ok()?;
                Some(Rgba::with_alpha(
                    (v >> 16) as u8,
                    ((v >> 8) & 0xFF) as u8,
                    (v & 0xFF) as u8,
                    255,
                ))
            }
            8 => {
                let v = u32::from_str_radix(hex, 16).ok()?;
                Some(Rgba::with_alpha(
                    (v >> 24) as u8,
                    ((v >> 16) & 0xFF) as u8,
                    ((v >> 8) & 0xFF) as u8,
                    (v & 0xFF) as u8,
                ))
            }
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Font {
    pub face: String,
    pub point: u16,
    pub label_point: u16,
    pub line_spacing: u16,
}

impl Default for Font {
    fn default() -> Self {
        Font {
            face: "PingFang SC".into(),
            point: 14,
            label_point: 12,
            line_spacing: 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Orientation {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layout {
    pub orientation: Orientation,
    pub corner_radius: u16,
    pub border_width: u16,
    pub margin: u16,
    pub spacing: u16,
    pub shadow: u16,
}

impl Default for Layout {
    fn default() -> Self {
        Layout {
            orientation: Orientation::Horizontal,
            corner_radius: 8,
            border_width: 1,
            margin: 8,
            spacing: 6,
            shadow: 4,
        }
    }
}

/// 主题颜色槽。两端键名一致，因此编译器共用这一组名字。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Colors {
    pub back: Rgba,
    pub border: Rgba,
    pub text: Rgba,
    pub candidate_text: Rgba,
    pub comment_text: Rgba,
    pub hilited_back: Rgba,
    pub hilited_text: Rgba,
    pub hilited_candidate_back: Rgba,
    pub hilited_candidate_text: Rgba,
    pub hilited_candidate_border: Rgba,
    pub hilited_border: Rgba,
}

impl Colors {
    /// (Rime 键名, 颜色) —— 顺序决定生成文件里的顺序。
    pub fn entries(&self) -> [(&'static str, Rgba); 11] {
        [
            ("back_color", self.back),
            ("border_color", self.border),
            ("text_color", self.text),
            ("candidate_text_color", self.candidate_text),
            ("comment_text_color", self.comment_text),
            ("hilited_back_color", self.hilited_back),
            ("hilited_text_color", self.hilited_text),
            ("hilited_candidate_back_color", self.hilited_candidate_back),
            ("hilited_candidate_text_color", self.hilited_candidate_text),
            (
                "hilited_candidate_border_color",
                self.hilited_candidate_border,
            ),
            ("hilited_border_color", self.hilited_border),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    pub font: Font,
    pub layout: Layout,
    pub colors: Colors,
    /// 交集之外的字段：key 是 Rime 的斜杠路径，value 是原始 YAML 值文本。
    #[serde(default)]
    pub platform_specific: BTreeMap<String, BTreeMap<String, String>>,
}

impl Theme {
    /// 主题在 Rime 配置里的标识（`preset_color_schemes/<id>`）。
    pub fn scheme_id(&self) -> String {
        let mut id: String = self
            .name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect();
        while id.contains("__") {
            id = id.replace("__", "_");
        }
        let id = id.trim_matches('_').to_string();
        if id.is_empty() {
            "theme".to_string()
        } else if id.starts_with(|c: char| c.is_ascii_digit()) {
            format!("t_{id}")
        } else {
            id
        }
    }

    /// 编译成目标端 `*.custom.yaml` 的 patch 编辑。
    ///
    /// 返回值可直接交给 `patch::apply_edits`，从而复用同一套无损写回逻辑。
    pub fn edits(&self, platform: Platform) -> Vec<Edit> {
        let id = self.scheme_id();
        let mut edits = vec![
            Edit::set_raw("style/color_scheme", &id),
            Edit::set_raw(
                format!("preset_color_schemes/{id}"),
                self.preset_block(platform),
            ),
        ];

        edits.push(Edit::set_raw(
            "style/font_face",
            yaml_scalar(&self.font.face),
        ));
        edits.push(Edit::set(
            "style/font_point",
            Value::from(self.font.point as u64),
        ));
        edits.push(Edit::set(
            "style/label_font_point",
            Value::from(self.font.label_point as u64),
        ));
        edits.push(Edit::set(
            "style/line_spacing",
            Value::from(self.font.line_spacing as u64),
        ));

        let horizontal = matches!(self.layout.orientation, Orientation::Horizontal);
        match platform {
            Platform::Macos => {
                edits.push(Edit::set_raw(
                    "style/candidate_list_layout",
                    if horizontal { "linear" } else { "stacked" },
                ));
                edits.push(Edit::set_raw(
                    "style/text_orientation",
                    if horizontal { "horizontal" } else { "vertical" },
                ));
                edits.push(Edit::set(
                    "style/corner_radius",
                    Value::from(self.layout.corner_radius as u64),
                ));
                edits.push(Edit::set(
                    "style/border_width",
                    Value::from(self.layout.border_width as u64),
                ));
                edits.push(Edit::set(
                    "style/border_height",
                    Value::from(self.layout.border_width as u64),
                ));
                edits.push(Edit::set(
                    "style/spacing",
                    Value::from(self.layout.spacing as u64),
                ));
                edits.push(Edit::set(
                    "style/margin_x",
                    Value::from(self.layout.margin as u64),
                ));
                edits.push(Edit::set(
                    "style/margin_y",
                    Value::from(self.layout.margin as u64),
                ));
                edits.push(Edit::set(
                    "style/shadow_size",
                    Value::from(self.layout.shadow as u64),
                ));
            }
            Platform::Windows => {
                edits.push(Edit::set("style/horizontal", Value::from(horizontal)));
                edits.push(Edit::set(
                    "style/layout/corner_radius",
                    Value::from(self.layout.corner_radius as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/border_width",
                    Value::from(self.layout.border_width as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/margin_x",
                    Value::from(self.layout.margin as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/margin_y",
                    Value::from(self.layout.margin as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/spacing",
                    Value::from(self.layout.spacing as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/linespacing",
                    Value::from(self.font.line_spacing as u64),
                ));
                edits.push(Edit::set(
                    "style/layout/shadow_radius",
                    Value::from(self.layout.shadow as u64),
                ));
                edits.push(Edit::set("style/layout/shadow_offset_x", Value::from(0u64)));
                edits.push(Edit::set("style/layout/shadow_offset_y", Value::from(1u64)));
            }
        }

        if let Some(extra) = self.platform_specific.get(platform.as_str()) {
            for (key, raw) in extra {
                edits.push(Edit::set_raw(key, raw));
            }
        }

        edits
    }

    fn preset_block(&self, platform: Platform) -> String {
        let mut out = String::new();
        out.push_str(&format!("name: {}\n", yaml_scalar(&self.name)));
        for (key, color) in self.colors.entries() {
            out.push_str(&format!("{key}: {}\n", color.to_abgr_literal()));
        }
        out.push_str(&format!("font_face: {}\n", yaml_scalar(&self.font.face)));
        out.push_str(&format!("font_point: {}\n", self.font.point));
        out.push_str(&format!("label_font_point: {}\n", self.font.label_point));
        if let Some(extra) = self.platform_specific.get(platform.as_str()) {
            for (key, raw) in extra {
                if let Some(name) = key.strip_prefix("preset/") {
                    out.push_str(&format!("{name}: {raw}\n"));
                }
            }
        }
        out
    }

    /// 方便调试/导出的完整 YAML 片段（不含文件头注释）。
    pub fn to_yaml_fragment(&self, platform: Platform) -> String {
        let mut out = String::from("patch:\n");
        for edit in self.edits(platform) {
            match edit {
                Edit::SetRaw { key, raw } => {
                    if raw.contains('\n') {
                        out.push_str(&format!("  {key}:\n"));
                        for line in raw.trim_end().split('\n') {
                            out.push_str(&format!("    {line}\n"));
                        }
                    } else {
                        out.push_str(&format!("  {key}: {raw}\n"));
                    }
                }
                Edit::Set { key, value } => {
                    out.push_str(&format!("  {key}: {}\n", yaml_scalar(&scalar_text(&value))));
                }
                Edit::Remove { .. } => {}
            }
        }
        out
    }

    /// 内置预设主题。
    pub fn presets() -> Vec<Theme> {
        vec![
            Theme {
                name: "Z-Type Dark".into(),
                font: Font::default(),
                layout: Layout::default(),
                colors: Colors {
                    back: Rgba::rgb(0x1E, 0x1E, 0x1E),
                    border: Rgba::with_alpha(0xFF, 0xFF, 0xFF, 0x1A),
                    text: Rgba::rgb(0xE6, 0xE6, 0xE6),
                    candidate_text: Rgba::rgb(0xCC, 0xCC, 0xCC),
                    comment_text: Rgba::rgb(0x8A, 0x8A, 0x8A),
                    hilited_back: Rgba::rgb(0x2A, 0x2A, 0x2A),
                    hilited_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_candidate_back: Rgba::rgb(0x3A, 0x6E, 0xA5),
                    hilited_candidate_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_candidate_border: Rgba::with_alpha(0, 0, 0, 0),
                    hilited_border: Rgba::with_alpha(0, 0, 0, 0),
                },
                platform_specific: BTreeMap::new(),
            },
            Theme {
                name: "Z-Type Light".into(),
                font: Font::default(),
                layout: Layout::default(),
                colors: Colors {
                    back: Rgba::rgb(0xFA, 0xFA, 0xFA),
                    border: Rgba::with_alpha(0, 0, 0, 0x1A),
                    text: Rgba::rgb(0x1E, 0x1E, 0x1E),
                    candidate_text: Rgba::rgb(0x33, 0x33, 0x33),
                    comment_text: Rgba::rgb(0x88, 0x88, 0x88),
                    hilited_back: Rgba::rgb(0xEC, 0xEC, 0xEC),
                    hilited_text: Rgba::rgb(0, 0, 0),
                    hilited_candidate_back: Rgba::rgb(0x1B, 0x6E, 0xF0),
                    hilited_candidate_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_candidate_border: Rgba::with_alpha(0, 0, 0, 0),
                    hilited_border: Rgba::with_alpha(0, 0, 0, 0),
                },
                platform_specific: BTreeMap::new(),
            },
            Theme {
                name: "Paper".into(),
                font: Font {
                    face: "Songti SC".into(),
                    point: 15,
                    label_point: 12,
                    line_spacing: 3,
                },
                layout: Layout {
                    corner_radius: 2,
                    ..Layout::default()
                },
                colors: Colors {
                    back: Rgba::rgb(0xF5, 0xF0, 0xE6),
                    border: Rgba::with_alpha(0, 0, 0, 0x26),
                    text: Rgba::rgb(0x2B, 0x24, 0x1C),
                    candidate_text: Rgba::rgb(0x3A, 0x31, 0x26),
                    comment_text: Rgba::rgb(0x8C, 0x80, 0x6E),
                    hilited_back: Rgba::rgb(0xE8, 0xDF, 0xCD),
                    hilited_text: Rgba::rgb(0, 0, 0),
                    hilited_candidate_back: Rgba::rgb(0xB5, 0x8B, 0x4B),
                    hilited_candidate_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_candidate_border: Rgba::with_alpha(0, 0, 0, 0),
                    hilited_border: Rgba::with_alpha(0, 0, 0, 0),
                },
                platform_specific: BTreeMap::new(),
            },
            Theme {
                name: "High Contrast".into(),
                font: Font {
                    face: "SF Mono".into(),
                    point: 15,
                    label_point: 13,
                    line_spacing: 0,
                },
                layout: Layout {
                    corner_radius: 0,
                    border_width: 2,
                    shadow: 0,
                    ..Layout::default()
                },
                colors: Colors {
                    back: Rgba::rgb(0, 0, 0),
                    border: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    candidate_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    comment_text: Rgba::rgb(0xC8, 0xC8, 0xC8),
                    hilited_back: Rgba::rgb(0x00, 0x33, 0x66),
                    hilited_text: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_candidate_back: Rgba::rgb(0xFF, 0xEE, 0x00),
                    hilited_candidate_text: Rgba::rgb(0, 0, 0),
                    hilited_candidate_border: Rgba::rgb(0xFF, 0xFF, 0xFF),
                    hilited_border: Rgba::rgb(0xFF, 0xFF, 0xFF),
                },
                platform_specific: BTreeMap::new(),
            },
        ]
    }
}

fn scalar_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => serde_yaml::to_string(other)
            .unwrap_or_default()
            .trim_end()
            .to_string(),
    }
}

fn yaml_scalar(s: &str) -> String {
    match serde_yaml::to_string(&Value::String(s.to_string())) {
        Ok(text) => text.trim_end_matches('\n').to_string(),
        Err(_) => format!("\"{}\"", s.replace('"', "\\\"")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::patch::{apply_edits, CreatePolicy};

    #[test]
    fn abgr_layout_is_aabbggrr() {
        assert_eq!(Rgba::rgb(0x1E, 0x1E, 0x1E).to_abgr_literal(), "0xFF1E1E1E");
        assert_eq!(
            Rgba::with_alpha(0x11, 0x22, 0x33, 0x44).to_abgr_literal(),
            "0x44332211"
        );
        assert_eq!(Rgba::rgb(255, 255, 255).to_abgr(), 0xFFFFFFFF);
    }

    #[test]
    fn parse_roundtrip() {
        let c = Rgba::parse("#112233").unwrap();
        assert_eq!(c, Rgba::rgb(0x11, 0x22, 0x33));
        assert_eq!(c.to_abgr_literal(), "0xFF332211");
        assert_eq!(
            Rgba::parse("0x44332211").unwrap(),
            Rgba::with_alpha(0x11, 0x22, 0x33, 0x44)
        );
        assert_eq!(
            Rgba::parse("#11223344").unwrap(),
            Rgba::with_alpha(0x11, 0x22, 0x33, 0x44)
        );
    }

    #[test]
    fn scheme_id_is_yaml_safe() {
        assert_eq!(Theme::presets()[0].scheme_id(), "z_type_dark");
        let mut t = Theme::presets()[0].clone();
        t.name = "123".into();
        assert_eq!(t.scheme_id(), "t_123");
        t.name = "   ".into();
        assert_eq!(t.scheme_id(), "theme");
    }

    #[test]
    fn macos_compiles_to_valid_custom_yaml() {
        let theme = &Theme::presets()[0];
        let edits = theme.edits(Platform::Macos);
        let out = apply_edits("", &edits, CreatePolicy::Create).unwrap();

        assert!(out.contains("style/color_scheme: z_type_dark"));
        assert!(out.contains("back_color: 0xFF1E1E1E"));
        assert!(out.contains("preset_color_schemes/z_type_dark:"));
        assert!(out.contains("style/candidate_list_layout: linear"));
        assert!(out.contains("style/corner_radius: 8"));
        assert!(out.contains("style/font_face: PingFang SC"));

        // 生成物必须是合法 YAML，且字段可被解析回来
        let root: Value = serde_yaml::from_str(&out).unwrap();
        let patch = root.get("patch").unwrap();
        let scheme = patch.get("preset_color_schemes/z_type_dark").unwrap();
        assert_eq!(
            scheme.get("back_color").and_then(|v| v.as_u64()),
            Some(0xFF1E1E1E)
        );
    }

    #[test]
    fn windows_compiles_layout_block() {
        let theme = &Theme::presets()[0];
        let out = apply_edits("", &theme.edits(Platform::Windows), CreatePolicy::Create).unwrap();
        assert!(out.contains("style/horizontal: true"));
        assert!(out.contains("style/layout/corner_radius: 8"));
        assert!(out.contains("style/layout/linespacing: 2"));
        let root: Value = serde_yaml::from_str(&out).unwrap();
        assert_eq!(
            root.get("patch")
                .unwrap()
                .get("style/layout/corner_radius")
                .and_then(|v| v.as_u64()),
            Some(8)
        );
    }

    #[test]
    fn vertical_orientation_maps_to_stacked_on_macos() {
        let mut t = Theme::presets()[0].clone();
        t.layout.orientation = Orientation::Vertical;
        let out = apply_edits("", &t.edits(Platform::Macos), CreatePolicy::Create).unwrap();
        assert!(out.contains("style/candidate_list_layout: stacked"));
        assert!(out.contains("style/text_orientation: vertical"));
        let win = apply_edits("", &t.edits(Platform::Windows), CreatePolicy::Create).unwrap();
        assert!(win.contains("style/horizontal: false"));
    }

    #[test]
    fn presets_are_usable() {
        for t in Theme::presets() {
            let out = apply_edits("", &t.edits(Platform::Macos), CreatePolicy::Create).unwrap();
            let root: Value =
                serde_yaml::from_str(&out).unwrap_or_else(|e| panic!("{}: {e}", t.name));
            assert!(root.get("patch").is_some(), "{}", t.name);
        }
    }
}
