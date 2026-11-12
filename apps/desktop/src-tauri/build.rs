//! 构建期：Tauri 代码生成 + librime 运行期搜索路径。
//!
//! `qieyun-ffi` 的 build script 只能把 rpath 加到**它自己**的测试二进制上
//! （`cargo:rustc-link-arg` 不会跨 crate 传播）。所以最终二进制（本 crate）
//! 必须自己声明 rpath，否则启动时会 `dyld: Library not loaded: @rpath/librime.1.dylib`。
//!
//! 这里加两条：
//! 1. 开发期：指向仓库里的 `.deps/librime-prebuilt/dist/lib`（绝对路径）；
//! 2. 打包后：`@executable_path/../Frameworks`，供把 dylib 放进 bundle 的发布形态使用。

use std::env;
use std::path::PathBuf;

fn main() {
    tauri_build::build();
    emit_librime_rpath();
}

fn emit_librime_rpath() {
    if !cfg!(target_os = "macos") {
        return;
    }

    // 打包形态：dylib 与可执行文件同 bundle，放在 Contents/Frameworks
    println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = env::var("LIBRIME_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest.join("../../../.deps/librime-prebuilt/dist"));
    let lib = dist.join("lib");
    if lib.is_dir() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
    }

    println!("cargo:rerun-if-env-changed=LIBRIME_DIST");
}
