//! `qieyun-ffi` —— librime 的窄 ABI 封装。
//!
//! 设计：C shim（`src/shim.c`）直接 include `rime_api.h`，对 Rust 只暴露十来个函数；
//! Rust 侧不手抄 `RimeApi` 的几十个函数指针，升级 librime 只需重编 shim。
//!
//! 没有 librime 的机器上会编译 stub，`linked()` 返回 false，所有 API 返回错误——
//! 这样 CI 与纯前端开发者不会被一个 C 依赖卡住。

use std::ffi::{CStr, CString};
use std::marker::PhantomData;
use std::os::raw::{c_char, c_int};
use std::path::Path;

#[repr(C)]
struct QzEngine {
    _private: [u8; 0],
}

extern "C" {
    fn qz_version() -> *const c_char;
    fn qz_available() -> c_int;
    fn qz_deploy(user_dir: *const c_char, shared_dir: *const c_char) -> c_int;
    fn qz_create(user_dir: *const c_char, shared_dir: *const c_char) -> *mut QzEngine;
    fn qz_destroy(engine: *mut QzEngine);
    fn qz_session_new(engine: *mut QzEngine) -> usize;
    fn qz_session_destroy(engine: *mut QzEngine, session: usize);
    fn qz_process_key(engine: *mut QzEngine, session: usize, keycode: c_int) -> c_int;
    fn qz_context(
        engine: *mut QzEngine,
        session: usize,
        preedit: *mut c_char,
        preedit_cap: c_int,
        candidates: *mut c_char,
        candidates_cap: c_int,
    ) -> c_int;
    fn qz_set_option(
        engine: *mut QzEngine,
        session: usize,
        option: *const c_char,
        value: c_int,
    ) -> c_int;
    fn qz_get_option(engine: *mut QzEngine, session: usize, option: *const c_char) -> c_int;
    fn qz_current_schema(
        engine: *mut QzEngine,
        session: usize,
        out: *mut c_char,
        cap: c_int,
    ) -> c_int;
    fn qz_select(
        engine: *mut QzEngine,
        session: usize,
        index: c_int,
        commit: *mut c_char,
        commit_cap: c_int,
    ) -> c_int;
}

/// 本次构建是否链接了真实 librime。
pub fn linked() -> bool {
    cfg!(librime_linked) && unsafe { qz_available() == 1 }
}

/// librime 版本字符串。
pub fn version() -> String {
    unsafe {
        let ptr = qz_version();
        if ptr.is_null() {
            "(unknown)".to_string()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

fn cstring(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "路径包含 NUL 字符".to_string())
}

/// 进程内部署（不启动子进程）。
pub fn deploy(user_dir: &Path, shared_dir: &Path) -> Result<(), String> {
    if !linked() {
        return Err("当前构建未链接 librime".into());
    }
    let user = cstring(user_dir)?;
    let shared = cstring(shared_dir)?;
    let ok = unsafe { qz_deploy(user.as_ptr(), shared.as_ptr()) };
    if ok == 1 {
        Ok(())
    } else {
        Err("librime 部署失败（详见日志）".into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    pub text: String,
    pub comment: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Context {
    pub preedit: String,
    pub candidates: Vec<Candidate>,
}

/// 输入法引擎句柄（持有 librime 的 initialize 状态）。
pub struct Engine {
    raw: *mut QzEngine,
}

impl Engine {
    pub fn new(user_dir: &Path, shared_dir: &Path) -> Result<Self, String> {
        if !linked() {
            return Err("当前构建未链接 librime".into());
        }
        let user = cstring(user_dir)?;
        let shared = cstring(shared_dir)?;
        let raw = unsafe { qz_create(user.as_ptr(), shared.as_ptr()) };
        if raw.is_null() {
            return Err("librime 初始化失败".into());
        }
        Ok(Engine { raw })
    }

    /// 新建一个输入会话。
    ///
    /// 返回的 [`Session`] 在类型层面独占借用 `self`：会话存活期间引擎既不能移动
    /// 也不能再被借用，因此不可能出现"会话指向已释放引擎"的情况。
    pub fn session(&mut self) -> Result<Session<'_>, String> {
        let id = unsafe { qz_session_new(self.raw) };
        if id == 0 {
            return Err("创建会话失败".into());
        }
        Ok(Session {
            engine: self as *mut Engine,
            id,
            _marker: PhantomData,
        })
    }

    fn process_key(&mut self, session: usize, ch: char) -> bool {
        self.process_keycode(session, ch as c_int)
    }

    fn process_keycode(&mut self, session: usize, keycode: c_int) -> bool {
        unsafe { qz_process_key(self.raw, session, keycode) == 1 }
    }

    fn context(&mut self, session: usize) -> Context {
        let mut preedit = [0i8; 512];
        let mut candidates = [0i8; 8192];
        let n = unsafe {
            qz_context(
                self.raw,
                session,
                preedit.as_mut_ptr(),
                512,
                candidates.as_mut_ptr(),
                8192,
            )
        };
        if n < 0 {
            return Context::default();
        }
        let preedit = unsafe { CStr::from_ptr(preedit.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        let raw = unsafe { CStr::from_ptr(candidates.as_ptr()) }.to_string_lossy();
        let candidates = raw
            .lines()
            .filter(|line| !line.is_empty())
            .map(|line| {
                let mut parts = line.splitn(2, '\t');
                Candidate {
                    text: parts.next().unwrap_or_default().to_string(),
                    comment: parts.next().unwrap_or_default().to_string(),
                }
            })
            .collect();
        Context {
            preedit,
            candidates,
        }
    }

    fn select(&mut self, session: usize, index: usize) -> Option<String> {
        let mut commit = [0i8; 512];
        let ok = unsafe { qz_select(self.raw, session, index as c_int, commit.as_mut_ptr(), 512) };
        if ok != 1 {
            return None;
        }
        let text = unsafe { CStr::from_ptr(commit.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (!text.is_empty()).then_some(text)
    }

    fn set_option(&mut self, session: usize, option: &str, value: bool) -> bool {
        let Ok(option) = CString::new(option) else {
            return false;
        };
        unsafe { qz_set_option(self.raw, session, option.as_ptr(), value as c_int) == 1 }
    }

    fn get_option(&mut self, session: usize, option: &str) -> Option<bool> {
        let option = CString::new(option).ok()?;
        match unsafe { qz_get_option(self.raw, session, option.as_ptr()) } {
            1 => Some(true),
            0 => Some(false),
            _ => None,
        }
    }

    fn current_schema(&mut self, session: usize) -> Option<String> {
        let mut buf = [0i8; 256];
        let ok = unsafe { qz_current_schema(self.raw, session, buf.as_mut_ptr(), 256) };
        if ok != 1 {
            return None;
        }
        let id = unsafe { CStr::from_ptr(buf.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (!id.is_empty()).then_some(id)
    }

    fn destroy_session(&mut self, session: usize) {
        unsafe { qz_session_destroy(self.raw, session) };
    }

    /// 销毁引擎（Drop 时自动 finalize）。
    pub fn destroy(mut self) {
        self.close();
    }

    fn close(&mut self) {
        if !self.raw.is_null() {
            unsafe { qz_destroy(self.raw) };
            self.raw = std::ptr::null_mut();
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.close();
    }
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine").field("linked", &linked()).finish()
    }
}

/// 输入会话。
///
/// `Session<'a>` 在**类型层面**独占借用创建它的 `Engine`（`PhantomData<&'a mut Engine>`）：
///
/// - 会话存活期间引擎被借走，`drop(engine)` 或 `Engine::destroy()` 都无法编译——
///   原先"安全代码释放引擎后 `Drop` 访问已释放内存"的 use-after-free 从类型上被消除；
/// - 会话方法不再接收 `engine` 参数，只操作创建自己时保存的那个引擎，
///   因此"把 A 引擎的会话拿给 B 引擎用"也不可能发生；
/// - 会话不实现 `Send` / `Sync`（`*mut Engine` 本身就不是），不会跨线程漂移。
///
/// 销毁：`Drop` 兜底（忘记调用也不会泄漏），也可以显式 [`Session::destroy`]。
///
/// ```compile_fail
/// # use qieyun_ffi::Engine;
/// # fn demo(engine: &mut Engine) {
/// let mut session = engine.session().unwrap();
/// drop(engine); // 必须编译失败：session 借用了 engine
/// # }
/// ```
pub struct Session<'a> {
    /// 创建本会话的引擎。生命周期 `'a` 保证它在 `self` 存活期间一直有效且被独占借用。
    engine: *mut Engine,
    /// librime 的会话 id；销毁后置 0，作为"已销毁"的标记。
    id: usize,
    _marker: PhantomData<&'a mut Engine>,
}

impl<'a> Session<'a> {
    /// 取回创建本会话的引擎。
    ///
    /// # Safety（内部不变量）
    ///
    /// `Session` 只能由 [`Engine::session`] 构造，构造时通过 `PhantomData<&'a mut Engine>`
    /// 独占借走引擎；`&mut self` 保证同一时刻只有一个这样的借用，`'a` 保证引擎尚未释放。
    fn engine_mut(&mut self) -> &mut Engine {
        // SAFETY: 见上——指针由 `Engine::session` 从存活的 `&mut Engine` 得到，
        // 且生命周期参数使引擎不可能在会话存活期间被 drop/移动/另借。
        unsafe { &mut *self.engine }
    }

    /// 输入一串按键字符，返回被引擎接受（消费）的数量。
    pub fn type_keys(&mut self, keys: &str) -> usize {
        let id = self.id;
        let mut accepted = 0;
        for ch in keys.chars() {
            if self.engine_mut().process_key(id, ch) {
                accepted += 1;
            }
        }
        accepted
    }

    /// 当前的 preedit 与候选列表。
    pub fn context(&mut self) -> Context {
        let id = self.id;
        self.engine_mut().context(id)
    }

    /// 选中第 `index` 个候选，返回上屏文本（没有上屏时返回 `None`）。
    pub fn select(&mut self, index: usize) -> Option<String> {
        let id = self.id;
        self.engine_mut().select(id, index)
    }

    /// 显式销毁会话（可省略：`Drop` 也会兜底销毁）。
    pub fn destroy(mut self) {
        self.destroy_raw();
    }

    /// 切换会话选项（`ascii_mode`、`full_shape`、`transcription` 等）。
    pub fn set_option(&mut self, option: &str, value: bool) -> bool {
        let id = self.id;
        self.engine_mut().set_option(id, option, value)
    }

    /// 读取会话选项；未知选项返回 `None`。
    pub fn option(&mut self, option: &str) -> Option<bool> {
        let id = self.id;
        self.engine_mut().get_option(id, option)
    }

    /// 当前生效的方案 id。
    pub fn current_schema(&mut self) -> Option<String> {
        let id = self.id;
        self.engine_mut().current_schema(id)
    }

    /// 把会话里已输入的按键清空（逐个退格更可靠：librime 没有 clear_composition）。
    pub fn reset(&mut self) {
        let id = self.id;
        let engine = self.engine_mut();
        for _ in 0..128 {
            // BackSpace = 0xff08
            if !engine.process_keycode(id, 0xff08) {
                break;
            }
        }
    }

    /// 销毁底层会话并把 id 归零（幂等）。
    fn destroy_raw(&mut self) {
        let id = std::mem::take(&mut self.id);
        if id != 0 {
            self.engine_mut().destroy_session(id);
        }
    }
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        // 兜底销毁：调用方忘记 destroy 时也不会泄漏。
        // 类型安全：`'a` 保证此刻引擎一定还活着，且 `&mut Engine` 未被别处同时借用。
        self.destroy_raw();
    }
}

impl std::fmt::Debug for Session<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("id", &self.id)
            .field("destroyed", &(self.id == 0))
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_link_status() {
        // 两种情况都必须能编译/runs；只断言自洽性。
        if linked() {
            assert!(!version().is_empty());
        } else {
            assert_eq!(version(), "(librime not linked)");
        }
    }
}
