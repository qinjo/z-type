//! 运行环境探测：Rime 用户目录、共享目录、安装元信息。
//!
//! 事实（`docs/research/rime-facts.md`）：
//! - macOS 用户目录 `~/Library/Rime`，共享目录 `/Library/Application Support/Rime`；
//! - Windows 用户目录 `%APPDATA%\Rime`，共享目录在外壳安装目录的 `data`；
//! - `installation.yaml` 记录 distribution_name/version、installation_id、sync_dir、rime_version。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::platform::Platform;

/// 探测到的运行环境。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnvInfo {
    pub user_dir: PathBuf,
    pub shared_dir: Option<PathBuf>,
    pub platform: String,
    pub rime_version: Option<String>,
    pub distribution_name: Option<String>,
    pub distribution_version: Option<String>,
}

/// `installation.yaml` 里我们关心的字段。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallationMeta {
    pub installation_id: Option<String>,
    pub sync_dir: Option<String>,
    pub rime_version: Option<String>,
    pub distribution_name: Option<String>,
    pub distribution_version: Option<String>,
}

/// 当前用户目录的默认位置。
pub fn default_user_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    match Platform::current() {
        Platform::Macos => home
            .map(|h| h.join("Library/Rime"))
            .unwrap_or_else(|| PathBuf::from("~/Library/Rime")),
        Platform::Windows => std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|p| p.join("Rime"))
            .unwrap_or_else(|| PathBuf::from(r"%APPDATA%\Rime")),
    }
}

/// 可能存在的共享目录候选（按优先级）。
pub fn shared_dir_candidates() -> Vec<PathBuf> {
    match Platform::current() {
        Platform::Macos => vec![
            PathBuf::from("/Library/Application Support/Rime"),
            PathBuf::from("/usr/local/share/rime-data"),
        ],
        Platform::Windows => vec![std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .map(|p| p.join(r"Rime\data"))
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files\Rime\data"))],
    }
}

/// 找到第一个"看起来像共享目录"的候选：包含 `default.yaml`。
pub fn detect_shared_dir(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|dir| dir.join("default.yaml").is_file())
        .cloned()
}

/// 读取 `installation.yaml`；文件不存在返回 `None`。
pub fn read_installation(user_dir: &Path) -> Option<InstallationMeta> {
    let text = std::fs::read_to_string(user_dir.join("installation.yaml")).ok()?;
    let value: serde_yaml::Value = serde_yaml::from_str(&text).ok()?;
    let get = |key: &str| {
        value
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    Some(InstallationMeta {
        installation_id: get("installation_id"),
        sync_dir: get("sync_dir"),
        rime_version: get("rime_version"),
        distribution_name: get("distribution_name"),
        distribution_version: get("distribution_version"),
    })
}

/// 完整探测（`user_dir` 允许覆盖，便于多 profile）。
pub fn probe(user_dir: Option<&Path>) -> EnvInfo {
    let user_dir = user_dir
        .map(Path::to_path_buf)
        .unwrap_or_else(default_user_dir);
    let shared_dir = detect_shared_dir(&shared_dir_candidates());
    let meta = read_installation(&user_dir).unwrap_or_default();
    EnvInfo {
        user_dir,
        shared_dir,
        platform: Platform::current().as_str().to_string(),
        rime_version: meta.rime_version,
        distribution_name: meta.distribution_name,
        distribution_version: meta.distribution_version,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-env-{tag}-{}-{}",
            std::process::id(),
            crate::time::now_unix()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reads_installation_meta() {
        let dir = tmp("meta");
        std::fs::write(
            dir.join("installation.yaml"),
            "distribution_code_name: Squirrel\ndistribution_name: \"鼠鬚管\"\ndistribution_version: 0.18\ninstallation_id: abc-123\nsync_dir: \"/tmp/sync\"\nrime_version: 1.11.2\n",
        )
        .unwrap();
        let meta = read_installation(&dir).unwrap();
        assert_eq!(meta.installation_id.as_deref(), Some("abc-123"));
        assert_eq!(meta.sync_dir.as_deref(), Some("/tmp/sync"));
        assert_eq!(meta.rime_version.as_deref(), Some("1.11.2"));
        assert_eq!(meta.distribution_name.as_deref(), Some("鼠鬚管"));
        assert!(read_installation(&dir.join("nope")).is_none());
    }

    #[test]
    fn detects_shared_dir_by_default_yaml() {
        let root = tmp("shared");
        let a = root.join("a");
        let b = root.join("b");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(b.join("default.yaml"), "schema_list: []\n").unwrap();
        assert_eq!(detect_shared_dir(&[a, b.clone()]), Some(b));
        assert_eq!(detect_shared_dir(&[]), None);
    }

    #[test]
    fn probe_fills_platform_and_meta() {
        let dir = tmp("probe");
        std::fs::write(dir.join("installation.yaml"), "rime_version: 1.17.0\n").unwrap();
        let info = probe(Some(&dir));
        assert_eq!(info.user_dir, dir);
        assert!(matches!(info.platform.as_str(), "macos" | "windows"));
        assert_eq!(info.rime_version.as_deref(), Some("1.17.0"));
    }
}
