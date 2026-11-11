//! 端到端契约演示（不需要 librime）：
//! 主题编译 → 写入 custom.yaml → 记录托管键 → 漂移检测 → 快照回滚 → 重载计划。
//!
//! 这是给实现者的"行为说明书"：每一步的输入输出都可见。

use std::fs;
use std::path::PathBuf;

use qieyun_kit::fuzzy::{expand, FuzzyGroup};
use qieyun_kit::patch::{apply_edits, CreatePolicy, Edit};
use qieyun_kit::platform::Platform;
use qieyun_kit::theme::Theme;
use qieyun_kit::{reload, snapshot, State};

fn tmp_workdir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "qieyun-kit-flow-{tag}-{}-{}",
        std::process::id(),
        qieyun_kit::time::now_unix()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

const ORIGINAL: &str = "\
# 用户手写的注释：不许动
patch:
  schema_list:
    - schema: rime_ice
  # 我自己调的
  style/font_point: 13
";

#[test]
fn full_config_lifecycle() {
    let root = tmp_workdir("lifecycle");
    let rime_dir = root.join("Rime");
    let store = rime_dir.join(".qieyun/snapshots");
    fs::create_dir_all(&rime_dir).unwrap();

    let target = rime_dir.join("squirrel.custom.yaml");
    fs::write(&target, ORIGINAL).unwrap();
    let mut state = State::default();
    let file = "squirrel.custom.yaml";
    let now = qieyun_kit::time::format_iso8601_utc(qieyun_kit::time::now_unix());

    // 1) 首次写入：主题编译成 edits，落到 patch 层
    let theme = &Theme::presets()[0];
    let edits = theme.edits(Platform::Macos);
    let text = fs::read_to_string(&target).unwrap();
    assert!(
        state.detect_drift(file, &text).is_empty(),
        "首次没有托管键，不该有漂移"
    );

    let after = apply_edits(&text, &edits, CreatePolicy::Reject).unwrap();
    fs::write(&target, &after).unwrap();
    state.record_edits(file, &after, &edits, &now);

    assert!(after.contains("# 用户手写的注释：不许动"));
    assert!(!after.contains("  style/font_point: 8"));
    assert!(after.contains("style/color_scheme: qieyun_dark"));
    assert!(state.owned_keys(file).contains(&"style/color_scheme"));

    // 2) 幂等 + 无漂移
    let again = apply_edits(&after, &theme.edits(Platform::Macos), CreatePolicy::Reject).unwrap();
    assert_eq!(again, after);
    assert!(state.detect_drift(file, &again).is_empty());

    // 3) 用户手改托管键 → 漂移被检出（调用方应中止写入并要求确认）
    let hand_edited = again.replace(
        "style/color_scheme: qieyun_dark",
        "style/color_scheme: native",
    );
    assert_eq!(state.detect_drift(file, &hand_edited).len(), 1);

    // 4) 快照 → 破坏 → 恢复
    let before_restore = fs::read_to_string(&target).unwrap();
    let snap = snapshot::create(&rime_dir, &store, "改主题前").unwrap();
    assert!(snap.file_count >= 1);
    fs::write(&target, "patch:\n  broken: [\n").unwrap();
    snapshot::restore(&store.join(&snap.id), &rime_dir).unwrap();
    assert_eq!(fs::read_to_string(&target).unwrap(), before_restore);

    // 5) 模糊音规则可以叠加到 base algebra 上并去重
    let base = vec!["derive/^zh/z/".to_string()];
    let algebra = expand(&base, &[FuzzyGroup::ZhZ, FuzzyGroup::NL]);
    let algebra_edits = vec![Edit::set(
        "speller/algebra",
        serde_yaml::to_value(&algebra).unwrap(),
    )];
    let schema_file = "rime_ice.custom.yaml";
    let custom = apply_edits("", &algebra_edits, CreatePolicy::Create).unwrap();
    fs::write(rime_dir.join(schema_file), &custom).unwrap();
    let parsed: serde_yaml::Value = serde_yaml::from_str(&custom).unwrap();
    let list = parsed
        .get("patch")
        .and_then(|p| p.get("speller/algebra"))
        .and_then(|a| a.as_sequence())
        .unwrap();
    assert_eq!(list.len(), 3, "zh/z 已存在，应只新增 n/l 的两条");

    // 6) 重载计划：macOS 用 --reload，Windows 用 WeaselDeployer /deploy
    let mac = reload::plan(Platform::Macos, std::path::Path::new(""));
    assert_eq!(mac.args, vec!["--reload"]);
    let win = reload::plan(Platform::Windows, std::path::Path::new("C:/Rime"));
    assert_eq!(win.args, vec!["/deploy"]);

    // 7) 状态文件可持久化并读回
    let state_path = rime_dir.join(".qieyun/state.json");
    state.save(&state_path).unwrap();
    let loaded = State::load(&state_path).unwrap();
    assert_eq!(loaded.owned_keys(file), state.owned_keys(file));

    let _ = fs::remove_dir_all(&root);
}
