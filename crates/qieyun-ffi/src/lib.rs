//! `qieyun-ffi` —— librime 的窄 ABI 封装。
//!
//! 设计：C shim（`src/shim.c`）直接 include `rime_api.h`，对 Rust 只暴露十来个函数；
//! Rust 侧不手抄 `RimeApi` 的几十个函数指针，升级 librime 只需重编 shim。
//!
//! 没有 librime 的机器上会编译 stub，`linked()` 返回 false，所有 API 返回错误——
//! 这样 CI 与纯前端开发者不会被一个 C 依赖卡住。

use std::ffi::{CStr, CString};
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
    pub fn session(&mut self) -> Result<Session, String> {
        let id = unsafe { qz_session_new(self.raw) };
        if id == 0 {
            return Err("创建会话失败".into());
        }
        Ok(Session {
            engine: self as *mut Engine,
            id,
        })
    }

    fn process_key(&mut self, session: &Session, ch: char) -> bool {
        unsafe { qz_process_key(self.raw, session.id, ch as c_int) == 1 }
    }

    fn context(&mut self, session: &Session) -> Context {
        let mut preedit = [0i8; 512];
        let mut candidates = [0i8; 8192];
        let n = unsafe {
            qz_context(
                self.raw,
                session.id,
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

    fn select(&mut self, session: &Session, index: usize) -> Option<String> {
        let mut commit = [0i8; 512];
        let ok = unsafe {
            qz_select(
                self.raw,
                session.id,
                index as c_int,
                commit.as_mut_ptr(),
                512,
            )
        };
        if ok != 1 {
            return None;
        }
        let text = unsafe { CStr::from_ptr(commit.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        (!text.is_empty()).then_some(text)
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

/// 输入会话。`Session` 与创建它的 `Engine` 绑定，销毁由 `Engine::destroy_session` 负责。
#[derive(Debug)]
pub struct Session {
    engine: *mut Engine,
    id: usize,
}

impl Session {
    /// 输入一串按键字符，返回被引擎接受的数量。
    pub fn type_keys(&mut self, engine: &mut Engine, keys: &str) -> usize {
        let mut accepted = 0;
        for ch in keys.chars() {
            if engine.process_key(self, ch) {
                accepted += 1;
            }
        }
        accepted
    }

    pub fn context(&self, engine: &mut Engine) -> Context {
        engine.context(self)
    }

    pub fn select(&self, engine: &mut Engine, index: usize) -> Option<String> {
        engine.select(self, index)
    }

    pub fn destroy(mut self, engine: &mut Engine) {
        engine.destroy_session(&mut self);
    }
}

impl Engine {
    fn destroy_session(&mut self, session: &mut Session) {
        if session.id != 0 {
            unsafe { qz_session_destroy(self.raw, session.id) };
            session.id = 0;
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        // 防御：若调用方忘记 destroy，这里会尝试销毁，避免泄漏。
        if self.id != 0 && !self.engine.is_null() {
            let engine = unsafe { &mut *self.engine };
            unsafe { qz_session_destroy(engine.raw, self.id) };
            self.id = 0;
        }
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
