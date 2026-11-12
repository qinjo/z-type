//! 在真实机器上跑一遍配置体检：`cargo run -p qieyun-kit --example doctor [用户目录]`

use std::path::PathBuf;

use qieyun_kit::{diagnostics, env};

fn main() {
    let arg = std::env::args().nth(1).map(PathBuf::from);
    let info = env::probe(arg.as_deref());
    let report = diagnostics::run(&info.user_dir, info.shared_dir.as_deref());

    println!("体检对象：{}", info.user_dir.display());
    println!(
        "结果：{} 项通过 / {} 项提醒 / {} 项失败\n",
        report.ok, report.warn, report.fail
    );
    for c in &report.checks {
        let mark = match c.status {
            diagnostics::CheckStatus::Ok => "✅",
            diagnostics::CheckStatus::Warn => "⚠️ ",
            diagnostics::CheckStatus::Fail => "❌",
        };
        println!("{mark} {:<18} {}", c.id, c.title);
        println!("    {}", c.detail);
        if let Some(hint) = &c.hint {
            println!("    → {hint}");
        }
    }
}
