// Windows 发布构建时隐藏控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 切韵 桌面壳（最小占位）。
//!
//! M0 阶段只负责把 Tauri 窗口指向 Vite 产物，业务命令（get_env_info /
//! scan_profile / deploy …）由后续里程碑在 Rust 侧实现，契约见
//! `../src/lib/ipc.ts`。前端在检测不到 Tauri 运行时会自动走 mock，
//! 因此本文件不参与前端构建。

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("切韵启动失败");
}
