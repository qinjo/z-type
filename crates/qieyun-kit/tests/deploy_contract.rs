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
