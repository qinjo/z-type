//! 模糊音预设 → Rime `speller/algebra` 规则。
//!
//! 设计取舍（见 `docs/roadmap.md` M4）：模糊音是纯增量规则，可以放心让用户勾选；
//! 双拼键位与 `speller/algebra` 强耦合，只做"只读展示 + 方案切换"，不在这里生成。

use serde::{Deserialize, Serialize};

/// 一组模糊音。每个变体对应若干条 `derive/…/` 规则。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FuzzyGroup {
    /// zh ↔ z
    ZhZ,
    /// ch ↔ c
    ChC,
    /// sh ↔ s
    ShS,
    /// n ↔ l
    NL,
    /// f ↔ h
    FH,
    /// 前鼻音/后鼻音（an/ang、en/eng、in/ing 等）
    Nasal,
    /// r ↔ l
    RL,
}

impl FuzzyGroup {
    pub const ALL: &'static [FuzzyGroup] = &[
        FuzzyGroup::ZhZ,
        FuzzyGroup::ChC,
        FuzzyGroup::ShS,
        FuzzyGroup::NL,
        FuzzyGroup::FH,
        FuzzyGroup::Nasal,
        FuzzyGroup::RL,
    ];

    /// 用户可见名称。
    pub fn label(self) -> &'static str {
        match self {
            FuzzyGroup::ZhZ => "zh ↔ z",
            FuzzyGroup::ChC => "ch ↔ c",
            FuzzyGroup::ShS => "sh ↔ s",
            FuzzyGroup::NL => "n ↔ l",
            FuzzyGroup::FH => "f ↔ h",
            FuzzyGroup::Nasal => "前后鼻音（an/ang、en/eng、in/ing）",
            FuzzyGroup::RL => "r ↔ l",
        }
    }

    /// 展开成的 algebra 规则（顺序稳定，便于生成稳定 diff）。
    pub fn rules(self) -> &'static [&'static str] {
        match self {
            FuzzyGroup::ZhZ => &["derive/^zh/z/"],
            FuzzyGroup::ChC => &["derive/^ch/c/"],
            FuzzyGroup::ShS => &["derive/^sh/s/"],
            FuzzyGroup::NL => &["derive/^n/l/", "derive/^l/n/"],
            FuzzyGroup::FH => &["derive/^f/h/", "derive/^h/f/"],
            FuzzyGroup::Nasal => &[
                "derive/([aeiou])ng$/$1n/",
                "derive/([aeiou])n$/$1ng/",
                "derive/in$/ing/",
                "derive/ing$/in/",
            ],
            FuzzyGroup::RL => &["derive/^r/l/", "derive/^l/r/"],
        }
    }
}

/// 把选中的模糊音组展开成去重后的规则列表。
///
/// `base` 是方案原有的 algebra 规则（从编译产物读出），返回值为
/// `base + 新规则（去重）`，可直接写回 `<schema>.custom.yaml` 的 `speller/algebra`。
pub fn expand(base: &[String], groups: &[FuzzyGroup]) -> Vec<String> {
    let mut out: Vec<String> = base.to_vec();
    for group in groups {
        for rule in group.rules() {
            if !out.iter().any(|existing| existing == rule) {
                out.push((*rule).to_string());
            }
        }
    }
    out
}

/// 方案级 custom 文件名。
pub fn schema_custom_file(schema_id: &str) -> String {
    format!("{schema_id}.custom.yaml")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expand_is_deduped_and_order_stable() {
        let base = vec!["derive/^zh/z/".to_string()];
        let first = expand(&base, &[FuzzyGroup::ZhZ, FuzzyGroup::NL]);
        assert_eq!(
            first,
            ["derive/^zh/z/", "derive/^n/l/", "derive/^l/n/"]
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        );
        let second = expand(&base, &[FuzzyGroup::ZhZ, FuzzyGroup::NL]);
        assert_eq!(first, second);
    }

    #[test]
    fn nasal_group_covers_front_and_back() {
        let rules = expand(&[], &[FuzzyGroup::Nasal]);
        assert!(rules.iter().any(|r| r.contains("ng$")));
        assert!(rules.iter().any(|r| r.contains("in$")));
    }

    #[test]
    fn every_group_has_label_and_rules() {
        for g in FuzzyGroup::ALL {
            assert!(!g.label().is_empty());
            assert!(!g.rules().is_empty());
        }
    }

    #[test]
    fn custom_file_name() {
        assert_eq!(schema_custom_file("rime_ice"), "rime_ice.custom.yaml");
    }
}
