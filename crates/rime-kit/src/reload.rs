//! 部署之后如何让运行中的输入法重新加载。
//!
//! 事实（2026-11 核实，见 `rime-facts.md`）：
//! - macOS（Squirrel）：`DistributedNotificationCenter` 通知名 `SquirrelReloadNotification`，
//!   由外壳可执行文件带 `--reload` 投递；无需改外壳代码。
//! - Windows（Weasel）：`WeaselIPC` 没有 deploy 命令，官方入口是 `WeaselDeployer.exe /deploy`，
//!   内部走 `StartMaintenance → deploy → EndMaintenance`。
//!
//! 因此这里只生成"重载计划"，由调用方 spawn；失败时使用 `fallback_hint`。

use std::path::{Path, PathBuf};

use crate::platform::Platform;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReloadPlan {
    pub platform: Platform,
    pub program: PathBuf,
    pub args: Vec<String>,
    /// 计划失败时给用户看的手动兜底提示。
    pub fallback_hint: String,
}

impl ReloadPlan {
    /// 外壳/部署器是否看起来已安装。
    pub fn looks_installed(&self) -> bool {
        self.program.exists()
    }
}

/// macOS 默认安装位置。
pub const MACOS_APP_BINARY: &str = "/Library/Input Methods/Squirrel.app/Contents/MacOS/Squirrel";
/// Windows 下 WeaselDeployer 的相对位置（相对安装目录，常见为 `%ProgramFiles%\\Rime\\weasel-<ver>`）。
pub const WINDOWS_DEPLOYER: &str = "WeaselDeployer.exe";

/// 生成重载计划。`install_root` 为外壳安装根目录（macOS 传 app bundle 路径，Windows 传安装目录）。
pub fn plan(platform: Platform, install_root: &Path) -> ReloadPlan {
    match platform {
        Platform::Macos => {
            let program = if install_root.as_os_str().is_empty() {
                PathBuf::from(MACOS_APP_BINARY)
            } else {
                install_root.join("Contents/MacOS/Squirrel")
            };
            ReloadPlan {
                platform,
                program,
                args: vec!["--reload".to_string()],
                fallback_hint: "请在输入法菜单里点「重新部署」，或注销后重新登录。".to_string(),
            }
        }
        Platform::Windows => ReloadPlan {
            platform,
            program: install_root.join(WINDOWS_DEPLOYER),
            args: vec!["/deploy".to_string()],
            fallback_hint: "请在托盘图标菜单里点「重新部署」。".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_plan_uses_reload_flag() {
        let p = plan(Platform::Macos, Path::new(""));
        assert!(p.program.ends_with("Squirrel"));
        assert_eq!(p.args, vec!["--reload"]);
        assert!(!p.fallback_hint.is_empty());
    }

    #[test]
    fn windows_plan_uses_weasel_deployer() {
        let p = plan(Platform::Windows, Path::new("C:/Program Files/Rime"));
        assert!(p.program.ends_with("WeaselDeployer.exe"));
        assert_eq!(p.args, vec!["/deploy"]);
    }

    #[test]
    fn custom_install_root_is_respected() {
        let p = plan(
            Platform::Macos,
            Path::new("/Library/Input Methods/Rime Studio.app"),
        );
        assert_eq!(
            p.program,
            PathBuf::from("/Library/Input Methods/Rime Studio.app/Contents/MacOS/Squirrel")
        );
    }
}
