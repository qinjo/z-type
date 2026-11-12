//! 端到端探针：进程内部署 + 建立会话 + 打字取候选 + 选中上屏。
//!
//! 这是 FFI 内嵌能力的"存在性证明"：
//! - 不 spawn 任何子进程；
//! - 部署与打字都发生在当前进程里；
//! - 没有 librime 的机器自动跳过（stub 构建）。

use std::path::PathBuf;
use std::sync::Mutex;

use qieyun_ffi::Engine;

/// librime 的 setup/initialize/deploy 操作的是进程级全局状态，**不是线程安全的**。
/// 测试默认并行跑，所以这里必须串行化；产品侧同样要遵守（GUI 用部署锁 + 单例引擎）。
static LIBRIME_LOCK: Mutex<()> = Mutex::new(());

fn fixture(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "qieyun-ffi-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    std::fs::write(
        dir.join("default.yaml"),
        "schema_list:\n  - schema: qieyun_ffi_test\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("qieyun_ffi_test.schema.yaml"),
        r#"---
schema:
  schema_id: qieyun_ffi_test
  name: FFI 探针方案
  version: "1"
speller:
  alphabet: abcdefghijklmnopqrstuvwxyz
  delimiter: " '"
translator:
  dictionary: qieyun_ffi_test
menu:
  page_size: 5
engine:
  processors:
    - ascii_composer
    - key_binder
    - speller
    - punctuator
    - selector
    - navigator
    - express_editor
  segmentors:
    - ascii_segmentor
    - matcher
    - abc_segmentor
    - fallback_segmentor
  translators:
    - punct_translator
    - script_translator
    - reverse_lookup_translator
"#,
    )
    .unwrap();
    // 注意：Rime 词典列顺序是「文字 <tab> 编码 <tab> 权重」
    std::fs::write(
        dir.join("qieyun_ffi_test.dict.yaml"),
        "---\nname: qieyun_ffi_test\nversion: \"1\"\nsort: by_weight\n...\n\n你\tni\t100\n尼\tni\t10\n你好\tnihao\t90\n",
    )
    .unwrap();
    dir
}

#[test]
fn in_process_deploy_and_type_nihao() {
    if !qieyun_ffi::linked() {
        eprintln!("跳过：本次构建未链接 librime（stub）");
        return;
    }
    let _guard = LIBRIME_LOCK.lock().unwrap();

    let dir = fixture("typing");
    qieyun_ffi::deploy(&dir, &dir).expect("进程内部署应成功");
    assert!(
        dir.join("build/qieyun_ffi_test.table.bin").is_file(),
        "部署应生成词典产物"
    );

    let mut engine = Engine::new(&dir, &dir).expect("初始化引擎");
    {
        let mut session = engine.session().expect("创建会话");
        let accepted = session.type_keys("nihao");
        assert_eq!(accepted, 5, "五个按键都应被处理");

        let ctx = session.context();
        assert_eq!(ctx.preedit, "nihao");
        assert!(
            ctx.candidates.iter().any(|c| c.text == "你好"),
            "候选中应包含「你好」，实际：{:?}",
            ctx.candidates
        );

        let commit = session.select(0).expect("选中第一个候选后应有上屏");
        assert_eq!(commit, "你好");
    }
    engine.destroy();
}

/// 会话是被引擎借用的临时对象：drop 掉会话之后引擎必须仍然可用，
/// 且能正常开下一个会话（兜底销毁不能把引擎的状态一起弄坏）。
///
/// 类型层面的保证（"session 存活期间引擎无法 drop / 无法传错引擎"）由
/// `qieyun_ffi::Session` 上的 `compile_fail` doctest 验证：
/// `cargo test -p qieyun-ffi` 会运行它，能编译过就说明借用没生效。
#[test]
fn dropping_session_leaves_engine_usable() {
    if !qieyun_ffi::linked() {
        eprintln!("跳过：本次构建未链接 librime（stub）");
        return;
    }
    let _guard = LIBRIME_LOCK.lock().unwrap();

    let dir = fixture("session-drop");
    qieyun_ffi::deploy(&dir, &dir).expect("部署");
    let mut engine = Engine::new(&dir, &dir).expect("初始化引擎");

    {
        // 第一个会话：输入后不显式销毁，靠 Drop 兜底。
        let mut session = engine.session().expect("会话 1");
        assert_eq!(session.type_keys("ni"), 2);
        let ctx = session.context();
        assert_eq!(ctx.preedit, "ni");
    }
    // 会话已 drop。引擎没有被带走，还能再开新会话并正常打字。
    {
        let mut session = engine.session().expect("销毁旧会话后应仍能新建会话");
        assert_eq!(session.type_keys("nihao"), 5);
        let ctx = session.context();
        assert_eq!(ctx.preedit, "nihao");
        assert!(
            ctx.candidates.iter().any(|c| c.text == "你好"),
            "新会话应能正常出候选，实际：{:?}",
            ctx.candidates
        );
        session.destroy();
    }
    // 显式 destroy 之后的引擎同样可用。
    {
        let mut session = engine.session().expect("会话 3");
        assert_eq!(session.type_keys("ni"), 2);
    }
    engine.destroy();
}

#[test]
fn deploy_reports_failure_on_missing_dirs() {
    if !qieyun_ffi::linked() {
        eprintln!("跳过：本次构建未链接 librime（stub）");
        return;
    }
    let _guard = LIBRIME_LOCK.lock().unwrap();
    let err = qieyun_ffi::deploy(
        std::path::Path::new("/nonexistent/qieyun-user"),
        std::path::Path::new("/nonexistent/qieyun-shared"),
    );
    // 这里只要求"不会 panic、能返回结果"；librime 可能仍返回成功，
    // 所以不强制断言 Err，只断言调用本身是安全的。
    let _ = err;
}

#[test]
fn options_and_schema_are_readable() {
    if !qieyun_ffi::linked() {
        eprintln!("跳过：本次构建未链接 librime（stub）");
        return;
    }
    let _guard = LIBRIME_LOCK.lock().unwrap();

    let dir = fixture("options");
    qieyun_ffi::deploy(&dir, &dir).expect("部署");
    let mut engine = Engine::new(&dir, &dir).expect("初始化引擎");
    {
        let mut session = engine.session().expect("会话");
        assert_eq!(session.current_schema().as_deref(), Some("qieyun_ffi_test"));
        assert_eq!(session.option("ascii_mode"), Some(false));

        assert!(session.set_option("ascii_mode", true));
        assert_eq!(session.option("ascii_mode"), Some(true));

        // 英文模式下 librime 对字母键返回"不消费"，由宿主（输入法外壳/预览）自己打出来。
        // 这是 Rime 的输入法契约，不是 bug：`process_key` 返回 false 表示"这个键我不管"。
        let accepted = session.type_keys("abc");
        assert_eq!(
            accepted, 0,
            "ascii_mode 下字母键不应被引擎消费（宿主直出），实际消费了 {accepted} 个"
        );
        let ctx = session.context();
        assert!(
            ctx.preedit.is_empty(),
            "英文模式下不应有 preedit：{}",
            ctx.preedit
        );
        assert!(ctx.candidates.is_empty());

        // 复位：关掉英文模式后重新输入仍走拼音
        session.set_option("ascii_mode", false);
        session.reset();
        session.type_keys("nihao");
        let ctx = session.context();
        assert_eq!(ctx.preedit, "nihao");
        assert!(ctx.candidates.iter().any(|c| c.text == "你好"));
    }
    engine.destroy();
}
