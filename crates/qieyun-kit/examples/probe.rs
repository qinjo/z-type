//! 在真实机器上探查 Rime 配置，验证 env/profile 模块。
//!
//! 用法：`cargo run -p qieyun-kit --example probe [用户目录]`

use std::path::PathBuf;

use qieyun_kit::{env, profile};

fn main() {
    let arg = std::env::args().nth(1).map(PathBuf::from);
    let info = env::probe(arg.as_deref());
    println!("用户目录 : {}", info.user_dir.display());
    println!(
        "共享目录 : {}",
        info.shared_dir
            .as_ref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "（未找到）".into())
    );
    println!("平台     : {}", info.platform);
    println!(
        "分发     : {} {}",
        info.distribution_name.as_deref().unwrap_or("-"),
        info.distribution_version.as_deref().unwrap_or("")
    );
    println!("Rime 版本: {}", info.rime_version.as_deref().unwrap_or("-"));

    let p = profile::scan(&info.user_dir, info.shared_dir.as_deref());
    println!(
        "\n默认方案 : {}",
        p.default_schema.as_deref().unwrap_or("（无）")
    );
    println!("方案（{}）:", p.schemas.len());
    for s in &p.schemas {
        println!(
            "  [{}] {:<28} {:<16} custom={}",
            if s.enabled { "x" } else { " " },
            s.id,
            s.name,
            s.has_custom
        );
    }
    println!(
        "\n主题（{}）: 当前={}",
        p.themes.len(),
        p.current_theme.as_deref().unwrap_or("（无）")
    );
    for t in &p.themes {
        println!("  - {t}");
    }
    println!("\nGUI 写入面:");
    for f in &p.custom_files {
        println!("  - {f}");
    }
}
