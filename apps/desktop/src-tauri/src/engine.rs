//! 进程内 librime 引擎（单例 + 串行）。
//!
//! **为什么必须串行**：librime 的 `setup / initialize / finalize / deploy` 操作的是进程级
//! 全局状态，不是线程安全的。并行调用会直接 SIGSEGV（FFI 探针里实测过）。
//! 所以这里用一个全局 `Mutex`，并且**任何存活中的 Engine 都会阻止并发 deploy**。
//!
//! **为什么 deploy 会丢弃引擎**：`qz_deploy` 内部会 `setup + finalize`，
//! 若此时有已初始化的引擎存活，两者会互相破坏。因此 deploy 前先销毁引擎，事后按需重建。

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::Serialize;

use qieyun_ffi::{Candidate, Context, Engine};

/// 进程内 librime 的全局状态。
struct Inner {
    engine: Option<Engine>,
    /// 引擎创建时使用的目录，变化时需要重建。
    dirs: Option<(PathBuf, PathBuf)>,
}

// SAFETY: `Inner` 持有 librime 的原始指针，本身不是线程安全的。
// 但我们保证**所有**访问都经过下面这个 `Mutex`，且从不把 `&Engine` 泄漏到锁外；
// librime 的全局状态本来就是单线程的，串行化正是它要求的使用方式。
unsafe impl Send for Inner {}

static STATE: OnceLock<Mutex<Inner>> = OnceLock::new();

fn state() -> &'static Mutex<Inner> {
    STATE.get_or_init(|| {
        Mutex::new(Inner {
            engine: None,
            dirs: None,
        })
    })
}

fn lock() -> MutexGuard<'static, Inner> {
    // 中毒说明上一次调用 panic 了；librime 的全局状态此时不可信，直接重建。
    state().lock().unwrap_or_else(|poisoned| {
        let mut inner = poisoned.into_inner();
        inner.engine = None;
        inner.dirs = None;
        state().lock().unwrap_or_else(|p| p.into_inner())
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineStatus {
    /// 本次构建是否链接了真实 librime。
    pub linked: bool,
    pub version: String,
    /// 引擎是否已创建（惰性创建）。
    pub initialized: bool,
    /// 最近一次创建引擎所用目录。
    pub user_dir: Option<String>,
    pub shared_dir: Option<String>,
}

pub fn status() -> EngineStatus {
    let inner = lock();
    EngineStatus {
        linked: qieyun_ffi::linked(),
        version: qieyun_ffi::version(),
        initialized: inner.engine.is_some(),
        user_dir: inner.dirs.as_ref().map(|(u, _)| u.display().to_string()),
        shared_dir: inner.dirs.as_ref().map(|(_, s)| s.display().to_string()),
    }
}

/// 预期要用的 (user, shared)。shared 缺失时退回 user（plum 安装形态）——
/// 这也是 FFI 探针验证过的可用组合。
pub fn resolve_dirs(user_dir: &Path, shared_dir: Option<&Path>) -> (PathBuf, PathBuf) {
    let shared = shared_dir
        .filter(|d| d.is_dir())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| user_dir.to_path_buf());
    (user_dir.to_path_buf(), shared)
}

/// 确保引擎存在（惰性创建）。目录变化时重建。
fn ensure_engine<'a>(
    inner: &'a mut Inner,
    user: &Path,
    shared: &Path,
) -> Result<&'a mut Engine, String> {
    let wanted = (user.to_path_buf(), shared.to_path_buf());
    let needs_rebuild = match (&inner.engine, &inner.dirs) {
        (Some(_), Some(current)) => current != &wanted,
        _ => true,
    };
    if needs_rebuild {
        inner.engine = None;
        inner.dirs = None;
        let engine = Engine::new(user, shared)?;
        inner.engine = Some(engine);
        inner.dirs = Some(wanted);
    }
    inner
        .engine
        .as_mut()
        .ok_or_else(|| "引擎创建失败".to_string())
}

/// 销毁引擎（下一次使用会重建）。
pub fn shutdown() {
    let mut inner = lock();
    inner.engine = None;
    inner.dirs = None;
}

/// 进程内部署。会先销毁引擎，部署完成后引擎按需重建。
pub fn deploy(user: &Path, shared: &Path) -> Result<(), String> {
    let mut inner = lock();
    inner.engine = None;
    inner.dirs = None;
    qieyun_ffi::deploy(user, shared)
}

/// 一次预览输入的结果。
#[derive(Debug, Clone, Serialize)]
pub struct PreviewResult {
    pub preedit: String,
    pub candidates: Vec<PreviewCandidate>,
    pub schema: Option<String>,
    /// 被引擎消费的按键数（其余按键由宿主直出，例如 ascii_mode 下）。
    pub accepted_keys: usize,
    pub linked: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewCandidate {
    pub text: String,
    pub comment: String,
}

impl From<Candidate> for PreviewCandidate {
    fn from(c: Candidate) -> Self {
        PreviewCandidate {
            text: c.text,
            comment: c.comment,
        }
    }
}

impl From<Context> for PreviewResult {
    fn from(ctx: Context) -> Self {
        PreviewResult {
            preedit: ctx.preedit,
            candidates: ctx.candidates.into_iter().map(Into::into).collect(),
            schema: None,
            accepted_keys: 0,
            linked: true,
        }
    }
}

/// "试打字"：在一个临时会话里输入 `keys`，返回 preedit 与候选。
///
/// 不污染任何真实会话：每次调用都新建并销毁 session。
pub fn preview(
    user: &Path,
    shared: &Path,
    keys: &str,
    schema: Option<&str>,
    page_size: Option<u8>,
) -> Result<PreviewResult, String> {
    let mut inner = lock();
    let engine = ensure_engine(&mut inner, user, shared)?;

    let mut result = PreviewResult {
        preedit: String::new(),
        candidates: Vec::new(),
        schema: None,
        accepted_keys: 0,
        linked: true,
    };

    let mut session = engine.session()?;
    if let Some(schema) = schema {
        if !schema.is_empty() {
            session.set_option(engine, "schema", false);
            // 切换方案的可靠做法是通过 `select_schema`；窄 ABI 里没暴露，
            // 因此这里只校验当前方案是否匹配，不匹配就明确报错而不是静默用错方案。
            let current = session.current_schema(engine);
            if current.as_deref() != Some(schema) {
                return Err(format!(
                    "预览只支持当前默认方案（当前 {}）。请先把它设为默认，或部署后重试。",
                    current.unwrap_or_else(|| "（未知）".into())
                ));
            }
        }
    }

    result.accepted_keys = session.type_keys(engine, keys);
    if let Some(size) = page_size {
        // page_size 是方案级配置，不是会话选项；这里只做提示性校验。
        if !(3..=10).contains(&size) {
            return Err(format!("候选数量必须在 3–10 之间，当前 {size}"));
        }
    }

    let ctx = session.context(engine);
    result.preedit = ctx.preedit;
    result.candidates = ctx.candidates.into_iter().map(Into::into).collect();
    result.schema = session.current_schema(engine);
    Ok(result)
}

/// 试打字并提交第 `index` 个候选，返回上屏文本。
pub fn preview_commit(
    user: &Path,
    shared: &Path,
    keys: &str,
    index: usize,
) -> Result<Option<String>, String> {
    let mut inner = lock();
    let engine = ensure_engine(&mut inner, user, shared)?;
    let mut session = engine.session()?;
    session.type_keys(engine, keys);
    Ok(session.select(engine, index))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "qieyun-engine-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("default.yaml"), "schema_list:\n  - schema: t\n").unwrap();
        std::fs::write(
            dir.join("t.schema.yaml"),
            "---\nschema:\n  schema_id: t\n  name: T\n  version: \"1\"\nspeller:\n  alphabet: abcdefghijklmnopqrstuvwxyz\n  delimiter: \" '\"\ntranslator:\n  dictionary: t\nmenu:\n  page_size: 5\nengine:\n  processors: [ascii_composer, key_binder, speller, punctuator, selector, navigator, express_editor]\n  segmentors: [ascii_segmentor, matcher, abc_segmentor, fallback_segmentor]\n  translators: [punct_translator, script_translator]\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("t.dict.yaml"),
            "---\nname: t\nversion: \"1\"\nsort: by_weight\n...\n\n你\tni\t100\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn resolve_dirs_falls_back_to_user_dir() {
        let dir = fixture();
        let (user, shared) = resolve_dirs(&dir, None);
        assert_eq!(user, dir);
        assert_eq!(shared, dir, "没有共享目录时应退回用户目录（plum 形态）");
    }

    #[test]
    fn status_is_always_available() {
        let s = status();
        assert_eq!(s.linked, qieyun_ffi::linked());
        assert!(!s.version.is_empty());
    }

    #[test]
    fn preview_types_and_rebuilds_engine_on_dir_change() {
        if !qieyun_ffi::linked() {
            eprintln!("跳过：未链接 librime");
            return;
        }
        let dir = fixture();
        let (user, shared) = resolve_dirs(&dir, None);
        deploy(&user, &shared).expect("部署");

        let first = preview(&user, &shared, "ni", None, None).expect("预览");
        assert_eq!(first.preedit, "ni");
        assert!(
            first.candidates.iter().any(|c| c.text == "你"),
            "{:?}",
            first.candidates
        );
        assert!(status().initialized);

        // 换目录 → 引擎必须重建，而不是用旧方案瞎跑
        let other = fixture();
        let (u2, s2) = resolve_dirs(&other, None);
        deploy(&u2, &s2).expect("部署2");
        let second = preview(&u2, &s2, "ni", None, None).expect("预览2");
        assert_eq!(second.preedit, "ni");

        shutdown();
        assert!(!status().initialized);
    }

    #[test]
    fn preview_commit_returns_text() {
        if !qieyun_ffi::linked() {
            eprintln!("跳过：未链接 librime");
            return;
        }
        let dir = fixture();
        let (user, shared) = resolve_dirs(&dir, None);
        deploy(&user, &shared).expect("部署");
        let commit = preview_commit(&user, &shared, "ni", 0).expect("提交");
        assert_eq!(commit.as_deref(), Some("你"));
    }

    #[test]
    fn preview_rejects_unknown_schema_instead_of_silently_wrong() {
        if !qieyun_ffi::linked() {
            eprintln!("跳过：未链接 librime");
            return;
        }
        let dir = fixture();
        let (user, shared) = resolve_dirs(&dir, None);
        deploy(&user, &shared).expect("部署");
        let err = preview(&user, &shared, "ni", Some("nope"), None).unwrap_err();
        assert!(err.contains("预览只支持当前默认方案"), "{err}");
    }

    #[test]
    fn stub_mode_degrades_with_error_not_panic() {
        if qieyun_ffi::linked() {
            eprintln!("跳过：本次已链接 librime");
            return;
        }
        let dir = fixture();
        let (user, shared) = resolve_dirs(&dir, None);
        assert!(preview(&user, &shared, "ni", None, None).is_err());
    }
}
