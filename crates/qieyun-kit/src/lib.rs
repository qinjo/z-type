//! `qieyun-kit` —— 切韵的领域核心。
//!
//! 设计原则：
//! 1. **不依赖 librime**：所有逻辑都是纯 Rust，可在任意机器上 `cargo test`。
//!    FFI 只存在于 `apps/desktop/src-tauri` 与平台外壳里。
//! 2. **写回是文本级手术**，不是 parse/serialize：注释与未托管键必须逐字节保留。
//! 3. **托管键清单是唯一的所有权来源**：只有登记在 `state.json` 里的键才会被改写，
//!    并且写入前做漂移检测（用户手改过的不覆盖）。
//!
//! 对应文档：`docs/architecture.md` §4/§5，决策记录见 `docs/adr/`。

pub mod env;
pub mod fuzzy;
pub mod input;
pub mod manifest;
pub mod patch;
pub mod platform;
pub mod profile;
pub mod reload;
pub mod snapshot;
pub mod theme;
pub mod time;
pub mod workspace;

pub use env::{probe, EnvInfo, InstallationMeta};
pub use input::{AsciiToggleKey, InputSettings, PageKeys, SettingsError};
pub use manifest::{Drift, State};
pub use patch::{apply_edits, CreatePolicy, Edit, PatchError};
pub use platform::Platform;
pub use profile::{Profile, SchemaEntry};
pub use theme::{Colors, Font, Layout, Orientation, Rgba, Theme};
pub use workspace::{Workspace, WriteError, WriteOutcome};
