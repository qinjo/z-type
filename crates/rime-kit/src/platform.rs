//! 目标平台。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
}

impl Platform {
    pub const fn as_str(self) -> &'static str {
        match self {
            Platform::Macos => "macos",
            Platform::Windows => "windows",
        }
    }

    /// 运行期检测当前平台（仅用于桌面端；测试里显式传参）。
    pub fn current() -> Self {
        if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Macos
        }
    }
}
