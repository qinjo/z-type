//! 文本级 YAML patch 写回引擎。
//!
//! Rime 的 `*.custom.yaml` 只有一个顶层 `patch:` 映射，键是斜杠路径（如
//! `style/font_point`）。本模块只做三件事：定位 `patch:` 块、按 1 级缩进查找键、
//! 对该键的行做替换/插入/删除——**其余行逐字节保留**。
//!
//! 明确不支持：内联映射（`patch: {...}`）。遇到时返回错误，由调用方降级为只读。

use serde_yaml::Value;
use sha2::{Digest, Sha256};

/// 一次写入意图。键是 Rime 的斜杠路径。
#[derive(Debug, Clone, PartialEq)]
pub enum Edit {
    Set {
        key: String,
        value: Value,
    },
    /// 预渲染的 YAML 值文本（用于主题编译这类需要保留十六进制字面量的场景）。
    SetRaw {
        key: String,
        raw: String,
    },
    Remove {
        key: String,
    },
}

impl Edit {
    pub fn set(key: impl Into<String>, value: impl Into<Value>) -> Self {
        Edit::Set {
            key: key.into(),
            value: value.into(),
        }
    }

    pub fn set_raw(key: impl Into<String>, raw: impl Into<String>) -> Self {
        Edit::SetRaw {
            key: key.into(),
            raw: raw.into(),
        }
    }

    pub fn remove(key: impl Into<String>) -> Self {
        Edit::Remove { key: key.into() }
    }

    pub fn key(&self) -> &str {
        match self {
            Edit::Set { key, .. } | Edit::SetRaw { key, .. } | Edit::Remove { key } => key,
        }
    }
}

/// 文件里没有 `patch:` 块时怎么办。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreatePolicy {
    /// 自动创建文件头或追加 `patch:` 块（GUI 首次接管时使用）。
    Create,
    /// 报错，由调用方决定（例如该文件本不该被 GUI 碰）。
    Reject,
}

#[derive(Debug, thiserror::Error)]
pub enum PatchError {
    #[error("文件中没有顶层 `patch:` 映射块，且当前策略不允许自动创建")]
    MissingPatchBlock,
    #[error("不支持内联 `patch:` 映射（如 `patch: {{...}}`），请改为块形式")]
    InlinePatchBlock,
    #[error("YAML 解析失败：{0}")]
    Parse(String),
    #[error("无法渲染键 `{key}` 的值：{source}")]
    Render {
        key: String,
        #[source]
        source: serde_yaml::Error,
    },
}

const DEFAULT_INDENT: usize = 2;
const BOM: char = '\u{feff}';

/// 对 `text` 依次应用 `edits`，返回新的完整文件内容。
///
/// 幂等：同一组 edits 连续应用两次，第二次输出与第一次完全相同。
pub fn apply_edits(text: &str, edits: &[Edit], policy: CreatePolicy) -> Result<String, PatchError> {
    if edits.is_empty() {
        return Ok(text.to_string());
    }

    let had_bom = text.starts_with(BOM);
    let body = if had_bom {
        &text[BOM.len_utf8()..]
    } else {
        text
    };
    // 统一按 LF 处理，输出时按原文件的换行风格还原。
    let crlf = body.contains("\r\n");
    let mut lines: Vec<String> = body
        .split('\n')
        .map(|s| {
            if crlf {
                s.strip_suffix('\r').unwrap_or(s).to_string()
            } else {
                s.to_string()
            }
        })
        .collect();

    if lines.iter().all(|l| l.trim().is_empty()) {
        match policy {
            CreatePolicy::Create => {
                lines = vec![
                    "# Managed by 切韵. Keys tracked in .qieyun-studio/state.json may be rewritten;".to_string(),
                    "# everything else in this file is yours and is preserved verbatim.".to_string(),
                    "patch:".to_string(),
                ];
            }
            CreatePolicy::Reject => return Err(PatchError::MissingPatchBlock),
        }
    }

    for edit in edits {
        let (start, end, indent) = locate_block(&lines, policy)?;
        let existing = find_key(&lines, start, end, indent, edit.key());

        let rendered = match edit {
            Edit::Set { key, value } => render_key_lines(indent, key, value)?,
            Edit::SetRaw { key, raw } => render_raw_lines(indent, key, raw),
            Edit::Remove { key } => {
                let _ = key;
                Vec::new()
            }
        };

        match existing {
            Some((key_line, key_end)) => {
                lines.splice(key_line..key_end, rendered);
            }
            None => {
                if matches!(edit, Edit::Remove { .. }) {
                    continue;
                }
                let at = insertion_point(&lines, start, end);
                lines.splice(at..at, rendered);
            }
        }

        // 结构发生变化后重新校验：块必须仍然可定位。
        locate_block(&lines, policy)?;
    }

    let sep = if crlf { "\r\n" } else { "\n" };
    let mut out = lines.join(sep);
    if had_bom {
        out.insert(0, BOM);
    }
    Ok(out)
}

/// 定位 `patch:` 块，返回 (块首行, 块尾行(不含), 内容缩进字节数)。
fn locate_block(
    lines: &[String],
    policy: CreatePolicy,
) -> Result<(usize, usize, usize), PatchError> {
    let mut patch_idx = None;
    for (i, line) in lines.iter().enumerate() {
        if indent_of(line) != Some(0) {
            continue;
        }
        let t = strip_comment(line.trim_end()).trim();
        if t == "patch:" {
            patch_idx = Some(i);
            break;
        }
        if t.starts_with("patch:") {
            return Err(PatchError::InlinePatchBlock);
        }
    }

    let Some(patch_idx) = patch_idx else {
        return match policy {
            CreatePolicy::Reject => Err(PatchError::MissingPatchBlock),
            CreatePolicy::Create => Err(PatchError::MissingPatchBlock),
        };
    };

    let start = patch_idx + 1;
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(start) {
        if is_blank(line) || is_comment(line) {
            continue;
        }
        if indent_of(line) == Some(0) {
            end = i;
            break;
        }
    }

    let indent = lines[start..end]
        .iter()
        .find(|l| !is_blank(l) && !is_comment(l))
        .and_then(|l| indent_of(l))
        .unwrap_or(DEFAULT_INDENT);

    Ok((start, end, indent))
}

/// 在块内查找键所在的行范围 `[key_line, key_end)`。
fn find_key(
    lines: &[String],
    start: usize,
    end: usize,
    indent: usize,
    key: &str,
) -> Option<(usize, usize)> {
    let mut i = start;
    while i < end {
        let line = &lines[i];
        if !is_blank(line) && !is_comment(line) && indent_of(line) == Some(indent) {
            if let Some(k) = key_token(line) {
                if k == key {
                    let mut j = i + 1;
                    while j < end {
                        let l = &lines[j];
                        if is_blank(l) {
                            break;
                        }
                        match indent_of(l) {
                            Some(ind) if ind > indent => j += 1,
                            _ => break,
                        }
                    }
                    return Some((i, j));
                }
            }
        }
        i += 1;
    }
    None
}

/// 新键插入位置：块内最后一条非空内容之后（不吞掉块尾空行）。
fn insertion_point(lines: &[String], start: usize, end: usize) -> usize {
    let mut at = end;
    while at > start && is_blank(&lines[at - 1]) {
        at -= 1;
    }
    at
}

fn render_key_lines(indent: usize, key: &str, value: &Value) -> Result<Vec<String>, PatchError> {
    let pad = " ".repeat(indent);
    let rendered = serde_yaml::to_string(value).map_err(|source| PatchError::Render {
        key: key.to_string(),
        source,
    })?;
    let rendered = rendered.trim_end_matches('\n');
    let value_lines: Vec<&str> = rendered.split('\n').collect();

    let scalar = matches!(
        value,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
    );

    if scalar && value_lines.len() == 1 {
        return Ok(vec![format!("{pad}{key}: {}", value_lines[0])]);
    }

    if scalar {
        // 块标量（多行字符串）：首行是 `|-` / `>` 之类的指示符。
        let mut out = vec![format!("{pad}{key}: {}", value_lines[0])];
        out.extend(value_lines[1..].iter().map(|l| format!("{pad}{l}")));
        return Ok(out);
    }

    // 映射 / 序列：一律块形式。serde_yaml 的输出从第 0 列开始，
    // 因此需要在键的缩进之外再缩进一级，才是该键的子内容。
    let mut out = vec![format!("{pad}{key}:")];
    out.extend(value_lines.iter().map(|l| format!("{pad}  {l}")));
    Ok(out)
}

/// 渲染预渲染文本：单行值内联，块形式整体缩进。
fn render_raw_lines(indent: usize, key: &str, raw: &str) -> Vec<String> {
    let pad = " ".repeat(indent);
    let raw = raw.trim_end_matches('\n');
    let lines: Vec<&str> = raw.split('\n').collect();
    // 单行且不像 `k: v` 的，按标量内联；其余按嵌套块处理。
    if lines.len() == 1 && !looks_like_mapping(lines[0]) {
        return vec![format!("{pad}{key}: {}", lines[0])];
    }
    let mut out = vec![format!("{pad}{key}:")];
    out.extend(lines.iter().map(|l| format!("{pad}  {l}")));
    out
}

fn looks_like_mapping(line: &str) -> bool {
    let t = line.trim();
    t.ends_with(':') || t.contains(": ")
}

fn indent_of(line: &str) -> Option<usize> {
    if line.trim().is_empty() {
        return None;
    }
    Some(line.len() - line.trim_start_matches(' ').len())
}

fn is_blank(line: &str) -> bool {
    line.trim().is_empty()
}

fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with('#')
}

fn strip_comment(s: &str) -> &str {
    match s.find('#') {
        Some(i) => &s[..i],
        None => s,
    }
}

/// 取出缩进为 `indent` 的行的键名，支持单双引号包裹。
fn key_token(line: &str) -> Option<String> {
    let t = line.trim_start();
    if t.starts_with('#') {
        return None;
    }
    let bytes = t.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' => {
                let quote = bytes[i];
                i += 1;
                while i < bytes.len() && bytes[i] != quote {
                    i += 1;
                }
                i += 1; // skip closing quote
                if i < bytes.len() && bytes[i] == b':' {
                    return Some(t[1..i - 1].to_string());
                }
                return None;
            }
            b':' => {
                // `a: b` 形式；排除 `http://` 之类的误判（键开头不会是冒号）。
                let key = t[..i].trim();
                return if key.is_empty() {
                    None
                } else {
                    Some(key.to_string())
                };
            }
            _ => i += 1,
        }
    }
    None
}

// ---------------------------------------------------------------------------
// 读取与漂移检测
// ---------------------------------------------------------------------------

/// 解析整份文件；空文件返回 `Value::Null`。
pub fn parse_root(text: &str) -> Result<Value, PatchError> {
    let body = text.strip_prefix(BOM).unwrap_or(text);
    if body.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_yaml::from_str(body).map_err(|e| PatchError::Parse(e.to_string()))
}

/// 读取 `patch` 下某个键的当前值。
pub fn get_patch_value<'a>(root: &'a Value, key: &str) -> Option<&'a Value> {
    root.get("patch")?.get(key)
}

/// 值的规范化 hash，用于漂移检测。
pub fn value_hash(value: &Value) -> String {
    let canonical = serde_json::to_string(value)
        .or_else(|_| serde_json::to_string(&format!("{value:?}")))
        .unwrap_or_default();
    let digest = Sha256::digest(canonical.as_bytes());
    format!("sha256:{digest:x}")
}

/// 文件里某个键当前值的 hash；键不存在返回 None。
pub fn current_hash(text: &str, key: &str) -> Option<String> {
    let root = parse_root(text).ok()?;
    get_patch_value(&root, key).map(value_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml::Value;

    fn yaml(s: &str) -> Value {
        serde_yaml::from_str(s).unwrap()
    }

    const SAMPLE: &str = "\
# 我的配置：手写的注释必须保住
patch:
  # 方案列表
  schema_list:
    - schema: rime_ice
  style/font_point: 13
  style/color_scheme: \"native\"   # 行尾注释
menu/page_size: 7
";

    #[test]
    fn replace_scalar_keeps_everything_else_byte_identical() {
        let out = apply_edits(
            SAMPLE,
            &[Edit::set("style/font_point", 15)],
            CreatePolicy::Reject,
        )
        .unwrap();
        assert!(out.contains("# 我的配置：手写的注释必须保住"));
        assert!(out.contains("  # 方案列表"));
        assert!(out.contains("    - schema: rime_ice"));
        assert!(out.contains("style/font_point: 15"));
        assert!(out.contains("menu/page_size: 7"));
        // 未触及的行逐字节保留
        let before: Vec<&str> = SAMPLE.lines().collect();
        let after: Vec<&str> = out.lines().collect();
        assert_eq!(before.len(), after.len());
        let changed: Vec<usize> = before
            .iter()
            .zip(after.iter())
            .enumerate()
            .filter(|(_, (a, b))| a != b)
            .map(|(i, _)| i)
            .collect();
        assert_eq!(changed, vec![5]);
    }

    #[test]
    fn insert_new_key_at_end_of_block() {
        let out = apply_edits(
            SAMPLE,
            &[Edit::set("style/font_face", "PingFang SC")],
            CreatePolicy::Reject,
        )
        .unwrap();
        let lines: Vec<&str> = out.lines().collect();
        let idx = lines
            .iter()
            .position(|l| l.starts_with("  style/font_face:"))
            .unwrap();
        assert_eq!(lines[idx], "  style/font_face: PingFang SC");
        // 插在 patch 块末尾、顶层键 menu/page_size 之前
        assert!(lines[idx + 1].starts_with("menu/page_size:"));
    }

    #[test]
    fn replace_scalar_with_block_sequence() {
        let out = apply_edits(
            SAMPLE,
            &[Edit::set("style/color_scheme", yaml("- a\n- b"))],
            CreatePolicy::Reject,
        )
        .unwrap();
        assert!(
            out.contains("  style/color_scheme:\n    - a\n    - b\nmenu/page_size: 7"),
            "{out}"
        );
    }

    #[test]
    fn remove_key_and_its_continuation_lines() {
        let out =
            apply_edits(SAMPLE, &[Edit::remove("schema_list")], CreatePolicy::Reject).unwrap();
        assert!(!out.contains("schema_list"));
        assert!(!out.contains("- schema: rime_ice"));
        assert!(out.contains("  # 方案列表")); // 注释属于用户，保留
        assert!(out.contains("style/font_point: 13"));
    }

    #[test]
    fn idempotent() {
        let edits = vec![
            Edit::set("style/font_point", 16),
            Edit::set("style/font_face", "Sarasa Mono SC"),
            Edit::remove("style/color_scheme"),
            Edit::set("preset_color_schemes/dark/back_color", 0x1E1E1Eu32),
        ];
        let once = apply_edits(SAMPLE, &edits, CreatePolicy::Reject).unwrap();
        let twice = apply_edits(&once, &edits, CreatePolicy::Reject).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn quoted_key_is_found() {
        let text = "patch:\n  \"style/font_point\": 12\n";
        let out = apply_edits(
            text,
            &[Edit::set("style/font_point", 14)],
            CreatePolicy::Reject,
        )
        .unwrap();
        assert_eq!(out, "patch:\n  style/font_point: 14\n");
    }

    #[test]
    fn empty_file_creates_header_and_block() {
        let out = apply_edits(
            "",
            &[Edit::set("style/font_point", 12)],
            CreatePolicy::Create,
        )
        .unwrap();
        assert!(out.starts_with("# Managed by 切韵"));
        assert!(out.contains("patch:\n  style/font_point: 12"));
    }

    #[test]
    fn missing_patch_block_rejects() {
        let err = apply_edits(
            "menu/page_size: 7\n",
            &[Edit::set("style/font_point", 12)],
            CreatePolicy::Reject,
        )
        .unwrap_err();
        assert!(matches!(err, PatchError::MissingPatchBlock));
    }

    #[test]
    fn crlf_preserved() {
        let text = "patch:\r\n  style/font_point: 12\r\n";
        let out = apply_edits(
            text,
            &[Edit::set("style/font_point", 13)],
            CreatePolicy::Reject,
        )
        .unwrap();
        assert_eq!(out, "patch:\r\n  style/font_point: 13\r\n");
    }

    #[test]
    fn drift_hash_detects_change() {
        let before = current_hash(SAMPLE, "style/font_point").unwrap();
        let after = apply_edits(
            SAMPLE,
            &[Edit::set("style/font_point", 99)],
            CreatePolicy::Reject,
        )
        .unwrap();
        let after_hash = current_hash(&after, "style/font_point").unwrap();
        assert_ne!(before, after_hash);
        assert_eq!(current_hash(SAMPLE, "nope"), None);
    }

    #[test]
    fn set_raw_keeps_hex_literals_and_is_idempotent() {
        let raw = "name: Qieyun Dark\nback_color: 0x1E1E1E\ntext_color: 0xE6E6E6";
        let edits = vec![Edit::set_raw("preset_color_schemes/ztype_dark", raw)];
        let once = apply_edits(SAMPLE, &edits, CreatePolicy::Reject).unwrap();
        assert!(once.contains(
            "  preset_color_schemes/ztype_dark:\n    name: Qieyun Dark\n    back_color: 0x1E1E1E"
        ));
        let twice = apply_edits(&once, &edits, CreatePolicy::Reject).unwrap();
        assert_eq!(once, twice);
    }

    #[test]
    fn inline_patch_is_rejected() {
        let err = apply_edits(
            "{patch: {a: 1}}",
            &[Edit::set("a", 2)],
            CreatePolicy::Reject,
        )
        .unwrap_err();
        // 流式根映射不是 `patch:` 行，按缺失处理
        assert!(matches!(err, PatchError::MissingPatchBlock));
        let err2 = apply_edits(
            "patch: {style/font_point: 12}\n",
            &[Edit::set("style/font_point", 13)],
            CreatePolicy::Reject,
        )
        .unwrap_err();
        assert!(matches!(err2, PatchError::InlinePatchBlock));
    }
}
