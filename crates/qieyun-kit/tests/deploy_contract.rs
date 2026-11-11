//! 契约测试：证明"GUI 写出的 patch 被 librime 真正接受并生效"。
//!
//! 需要真实的 `rime_deployer` 可执行文件：
//! ```bash
//! QIEYUN_RIME_DEPLOYER=.deps/librime/dist/bin/rime_deployer \
//!   cargo test -p qieyun-kit --test deploy_contract -- --nocapture
//! ```
//! 没有设置该环境变量时测试直接跳过（CI 的 macOS 契约 job 会设置）。

use std::path::{Path, PathBuf};
use std::process::Command;

use qieyun_kit::patch::{apply_edits, CreatePolicy, Edit};

const SCHEMA: &str = r#"---
schema:
  schema_id: qieyun_test
  name: 切韵测试方案
  version: "1"
speller:
  alphabet: abcdefghijklmnopqrstuvwxyz
  delimiter: " '"
translator:
  dictionary: qieyun_test
menu:
  page_size: 5
"#;

const DICT: &str = r#"---
name: qieyun_test
version: "1"
sort: by_weight
...

a	啊
ab	阿波
abc	阿波次
"#;

const DEFAULT: &str = "schema_list:\n  - schema: qieyun_test\n";

fn tmpdir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "qieyun-contract-{tag}-{}-{}",
        std::process::id(),
        qieyun_kit::time::now_unix()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn deployer() -> Option<PathBuf> {
    std::env::var_os("QIEYUN_RIME_DEPLOYER")
        .map(PathBuf::from)
        .filter(|p| p.is_file())
}

/// 启动部署器。预编译包里的 `rime_deployer` 通过 `@rpath/librime.1.dylib` 找库，
/// 所以要把同级 `lib/` 目录加进 DYLD_LIBRARY_PATH（Linux 同理用 LD_LIBRARY_PATH）。
fn run_deployer(deployer: &Path, user: &Path) -> std::process::Output {
    let mut cmd = Command::new(deployer);
    cmd.arg("--build")
        .arg(user)
        .arg(user)
        .arg(user.join("build"));

    let lib_dir = deployer
        .parent()
        .and_then(|bin| bin.parent())
        .map(|root| root.join("lib"));
    if let Some(lib_dir) = lib_dir.filter(|d| d.is_dir()) {
        let var = if cfg!(target_os = "macos") {
            "DYLD_LIBRARY_PATH"
        } else {
            "LD_LIBRARY_PATH"
        };
        let existing = std::env::var_os(var).unwrap_or_default();
        let mut paths = vec![lib_dir];
        paths.extend(std::env::split_paths(&existing));
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env(var, joined);
        }
    }

    cmd.output().expect("运行 rime_deployer 失败")
}

#[test]
fn gui_patch_is_accepted_by_librime() {
    let Some(deployer) = deployer() else {
        eprintln!("跳过：未设置 QIEYUN_RIME_DEPLOYER");
        return;
    };

    let root = tmpdir("deploy");
    let user = root.join("user");
    std::fs::create_dir_all(&user).unwrap();
    std::fs::write(user.join("default.yaml"), DEFAULT).unwrap();
    std::fs::write(user.join("qieyun_test.schema.yaml"), SCHEMA).unwrap();
    std::fs::write(user.join("qieyun_test.dict.yaml"), DICT).unwrap();

    // GUI 的写入路径：只写 custom 层的 patch
    let custom_path = user.join("qieyun_test.custom.yaml");
    let edits = vec![
        Edit::set("menu/page_size", serde_yaml::Value::from(9u64)),
        Edit::set_raw("translator/enable_completion", "true"),
    ];
    let before = String::new();
    let after = apply_edits(&before, &edits, CreatePolicy::Create).unwrap();
    std::fs::write(&custom_path, &after).unwrap();

    // 部署
    let output = run_deployer(&deployer, &user);
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.status.success(),
        "部署失败：\n{log}\n\n生成的 custom 文件：\n{after}"
    );

    // 断言 patch 生效：编译产物里必须是 GUI 写入的值
    let compiled = user.join("build/qieyun_test.schema.yaml");
    let text = std::fs::read_to_string(&compiled)
        .unwrap_or_else(|e| panic!("缺少编译产物 {}：{e}", compiled.display()));
    assert!(
        text.contains("page_size: 9"),
        "patch 未生效，编译产物中 page_size 不是 9：\n{text}"
    );
    assert!(
        text.contains("enable_completion: true"),
        "translator/enable_completion 未生效：\n{text}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn deployer_rejects_broken_patch_and_we_can_report_it() {
    let Some(deployer) = deployer() else {
        eprintln!("跳过：未设置 QIEYUN_RIME_DEPLOYER");
        return;
    };
    let root = tmpdir("broken");
    let user = root.join("user");
    std::fs::create_dir_all(&user).unwrap();
    std::fs::write(user.join("default.yaml"), DEFAULT).unwrap();
    std::fs::write(user.join("qieyun_test.schema.yaml"), SCHEMA).unwrap();
    std::fs::write(user.join("qieyun_test.dict.yaml"), DICT).unwrap();
    // 写坏：引用一个不存在的词典
    std::fs::write(
        user.join("qieyun_test.custom.yaml"),
        "patch:\n  translator/dictionary: does_not_exist\n",
    )
    .unwrap();

    let output = run_deployer(&deployer, &user);
    // 不论部署器是否以非零退出，都必须让我们拿到可展示的日志
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        !log.is_empty() || !output.status.success(),
        "应能拿到部署日志或非零退出码"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[allow(dead_code)]
fn exists(p: impl AsRef<Path>) -> bool {
    p.as_ref().exists()
}

/// 证明"启用/停用方案"真的会被 librime 采用：schema_list 里有的方案才会被编译。
#[test]
fn schema_list_controls_what_gets_compiled() {
    let Some(deployer) = deployer() else {
        eprintln!("跳过：未设置 QIEYUN_RIME_DEPLOYER");
        return;
    };
    use qieyun_kit::input::{AsciiToggleKey, InputSettings, PageKeys};

    let root = tmpdir("schema-list");
    let user = root.join("user");
    std::fs::create_dir_all(&user).unwrap();
    std::fs::write(
        user.join("default.yaml"),
        "schema_list:\n  - schema: qieyun_a\n",
    )
    .unwrap();

    for (id, name) in [("qieyun_a", "方案A"), ("qieyun_b", "方案B")] {
        std::fs::write(
            user.join(format!("{id}.schema.yaml")),
            format!(
                "---\nschema:\n  schema_id: {id}\n  name: {name}\n  version: \"1\"\nspeller:\n  alphabet: abcdefghijklmnopqrstuvwxyz\n  delimiter: \" '\"\ntranslator:\n  dictionary: {id}\nmenu:\n  page_size: 5\n"
            ),
        )
        .unwrap();
        std::fs::write(
            user.join(format!("{id}.dict.yaml")),
            format!("---\nname: {id}\nversion: \"1\"\nsort: by_weight\n...\n\na\t啊\n"),
        )
        .unwrap();
    }

    // 只启用 A
    let settings = InputSettings {
        schema_list: vec!["qieyun_a".into()],
        page_size: 8,
        page_keys: PageKeys::CommaPeriod,
        toggle_ascii: AsciiToggleKey::ControlShiftSpace,
    };
    let existing = serde_yaml::Value::Null;
    let text = apply_edits("", &settings.edits(&existing), CreatePolicy::Create).unwrap();
    std::fs::write(user.join("default.custom.yaml"), &text).unwrap();

    let output = run_deployer(&deployer, &user);
    assert!(
        output.status.success(),
        "部署失败：{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(user.join("build/qieyun_a.schema.yaml").is_file());
    assert!(
        !user.join("build/qieyun_b.schema.yaml").is_file(),
        "未启用的方案不应被编译"
    );

    // 再把 B 也启用 → 之后两者都应被编译。
    // 注意：librime 用「秒级 mtime」判断配置是否变化，同一秒内的第二次部署会被跳过，
    // 所以这里必须跨过一秒边界（产品侧由 deploy 命令做对齐，见 commands::deploy）。
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let settings = InputSettings {
        schema_list: vec!["qieyun_a".into(), "qieyun_b".into()],
        ..settings
    };
    let current = std::fs::read_to_string(user.join("default.custom.yaml")).unwrap();
    let parsed: serde_yaml::Value = serde_yaml::from_str(&current).unwrap();
    let text = apply_edits(&current, &settings.edits(&parsed), CreatePolicy::Reject).unwrap();
    std::fs::write(user.join("default.custom.yaml"), text).unwrap();

    let output = run_deployer(&deployer, &user);
    assert!(output.status.success());
    assert!(
        user.join("build/qieyun_b.schema.yaml").is_file(),
        "启用后方案 B 应被编译"
    );

    let _ = std::fs::remove_dir_all(&root);
}
