// Windows 发布构建时隐藏控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 切韵 · Qieyun Studio 桌面壳。
//!
//! 命令契约见 `../src/lib/ipc.ts`；业务逻辑在 `crates/qieyun-kit`，
//! 这一层只做参数校验与平台集成（路径、进程、部署器）。

mod commands;
mod paths;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_env_info,
            commands::scan_profile,
            commands::list_snapshots,
            commands::create_snapshot,
            commands::deploy,
            commands::read_file,
            commands::write_gui_config,
            commands::get_takeover_plan,
            commands::accept_takeover,
            commands::list_theme_presets,
            commands::apply_theme,
            commands::apply_and_deploy,
            commands::get_input_settings,
            commands::apply_input_settings,
            commands::get_schema_detail,
            commands::get_fuzzy_settings,
            commands::apply_fuzzy_settings,
            commands::run_diagnostics,
            commands::get_dict_inventory,
            commands::read_deploy_log,
            commands::restore_snapshot,
            commands::reveal_path,
        ])
        .run(tauri::generate_context!())
        .expect("切韵启动失败");
}
