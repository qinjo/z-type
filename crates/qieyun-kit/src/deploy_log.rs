//! 部署日志解析：把 librime 的原始日志变成"哪个文件/哪个键 + 该怎么办"。
//!
//! librime 的日志行格式（实测，rime 1.17）：
//! `E20261112 09:57:21.608622 0x7ff8490d1bc0 deployment_tasks.cc:212] missing input schema: ghost`
//! 即：级别字符 + 日期 + 时间 + 线程 + 源文件:行号 ] 消息。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeployLogEntry {
    pub level: LogLevel,
    /// 例如 `deployment_tasks.cc:212`。
    pub source: Option<String>,
    pub message: String,
    /// 消息里提到的文件名（.yaml / .bin 等）。
    pub files: Vec<String>,
    /// 面向用户的下一步动作。
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedDeployLog {
    pub entries: Vec<DeployLogEntry>,
    pub errors: usize,
    pub warnings: usize,
    /// 无法识别的行原文（保留，不丢信息）。
    pub unparsed: Vec<String>,
}

pub fn parse(text: &str) -> ParsedDeployLog {
    let mut out = ParsedDeployLog::default();
    for line in text.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        match parse_line(line) {
            Some(entry) => {
                match entry.level {
                    LogLevel::Error => out.errors += 1,
                    LogLevel::Warning => out.warnings += 1,
                    LogLevel::Info => {}
                }
                out.entries.push(entry);
            }
            None => {
                // 命令行回显（如 `$ rime_deployer --build ...`）不当作日志
                if !line.starts_with('$') {
                    out.unparsed.push(line.to_string());
                }
            }
        }
    }
    out
}

fn parse_line(line: &str) -> Option<DeployLogEntry> {
    let level = match line.chars().next()? {
        'E' => LogLevel::Error,
        'W' => LogLevel::Warning,
        'I' => LogLevel::Info,
        _ => return None,
    };
    // 必须是 `E<8 位日期>` 的形式，避免误判普通英文句子
    let rest = &line[1..];
    let date: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if date.len() != 8 {
        return None;
    }
    let (_, after_bracket) = line.split_once("] ")?;
    let mut message_and_source = after_bracket;

    // 反向找源位置 `xxx.cc:123`
    let source = {
        let token = line
            .split_whitespace()
            .find(|t| t.contains(".cc:") || t.contains(".hh:"));
        token.map(|t| t.trim_end_matches(']').trim_end_matches(':').to_string())
    };
    message_and_source = message_and_source.trim();
    if message_and_source.is_empty() {
        return None;
    }

    let files = extract_files(message_and_source);
    let hint = hint_for(message_and_source).map(str::to_string);

    Some(DeployLogEntry {
        level,
        source,
        message: message_and_source.to_string(),
        files,
        hint,
    })
}

fn extract_files(message: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for token in
        message.split(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | ',' | '(' | ')'))
    {
        let t = token.trim_matches(|c: char| c == ':' || c == ';' || c == '.');
        if t.ends_with(".yaml") || t.ends_with(".bin") || t.ends_with(".txt") {
            let t = t.trim_matches(|c: char| c == ':' || c == ';');
            if !t.is_empty() && !files.iter().any(|f| f == t) {
                files.push(t.to_string());
            }
        }
    }
    files
}

fn hint_for(message: &str) -> Option<&'static str> {
    let m = message.to_lowercase();
    if m.contains("missing input schema") {
        return Some(
            "方案未安装或 schema id 拼错：在「方案与启用」里停用它，或重新安装该方案后重新部署。",
        );
    }
    if m.contains("missing input dict") || m.contains("missing dict") {
        return Some(
            "方案引用的词典文件缺失：检查该方案的 translator/dictionary 指向，或重装词典。",
        );
    }
    if m.contains("missing") && m.contains(".schema.yaml") {
        return Some("方案定义文件缺失：重装该方案，或在「方案与启用」里停用它。");
    }
    if m.contains("yaml") && (m.contains("parse") || m.contains("invalid") || m.contains("error")) {
        return Some("YAML 语法错误：在「高级」页打开对应文件修正，或从快照回滚。");
    }
    if m.contains("duplicate") || m.contains("already exists") {
        return Some("存在重复定义：检查 schema_list 或自定义配置里是否有重复项。");
    }
    if m.contains("permission") || m.contains("denied") {
        return Some("权限不足：确认用户目录可写，或检查文件是否被其它程序占用。");
    }
    if m.contains("no space") || m.contains("disk full") {
        return Some("磁盘空间不足：清理后重新部署。");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = "\
$ .deps/librime-prebuilt/dist/bin/rime_deployer --build /tmp/x /tmp/x /tmp/x/build
E20261112 09:57:21.608622 0x7ff8490d1bc0 deployment_tasks.cc:212] missing input schema: ghost
W20261112 09:57:21.608622 0x7ff8490d1bc0 config.cc:99] invalid config: default.custom.yaml
some stray output
";

    #[test]
    fn parses_real_lines() {
        let parsed = parse(REAL);
        assert_eq!(parsed.errors, 1);
        assert_eq!(parsed.warnings, 1);
        assert_eq!(parsed.entries.len(), 2);

        let first = &parsed.entries[0];
        assert_eq!(first.level, LogLevel::Error);
        assert_eq!(first.source.as_deref(), Some("deployment_tasks.cc:212"));
        assert_eq!(first.message, "missing input schema: ghost");
        assert!(first
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("方案未安装"));

        let second = &parsed.entries[1];
        assert_eq!(second.level, LogLevel::Warning);
        assert_eq!(second.files, vec!["default.custom.yaml".to_string()]);
        assert!(second.hint.as_deref().unwrap_or_default().contains("YAML"));

        assert_eq!(parsed.unparsed, vec!["some stray output".to_string()]);
    }

    #[test]
    fn ignores_command_echo_and_plain_text() {
        let parsed = parse("$ rime_deployer --build a b c\nhello world\n\n");
        assert!(parsed.entries.is_empty());
        assert_eq!(parsed.unparsed, vec!["hello world".to_string()]);
    }

    #[test]
    fn missing_file_messages_get_hints() {
        let parsed = parse(
            "E20260101 00:00:00.000000 0x0 deployment_tasks.cc:212] missing input dict: rime_ice\n",
        );
        assert_eq!(parsed.errors, 1);
        assert!(parsed.entries[0]
            .hint
            .as_deref()
            .unwrap_or_default()
            .contains("词典文件缺失"));
    }

    #[test]
    fn unknown_error_still_reported_without_hint() {
        let parsed = parse("E20260101 00:00:00.000000 0x0 foo.cc:1] something weird happened\n");
        assert_eq!(parsed.errors, 1);
        assert!(parsed.entries[0].hint.is_none());
        assert_eq!(parsed.entries[0].message, "something weird happened");
    }
}
