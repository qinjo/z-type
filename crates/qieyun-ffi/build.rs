//! 编译 librime shim。
//!
//! 行为：
//! - 找得到 librime（默认仓库下 `.deps/librime-prebuilt/dist`，可用 `LIBRIME_DIST` 覆盖）
//!   → 编译 `src/shim.c` 并链接 `rime`；
//! - 找不到 → 编译 `src/shim_stub.c`，crate 仍可构建（CI/纯前端开发），运行时 `linked()` 为 false。

use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let dist = env::var("LIBRIME_DIST")
        .map(PathBuf::from)
        .unwrap_or_else(|_| manifest.join("../../.deps/librime-prebuilt/dist"));

    let include = dist.join("include");
    let lib = dist.join("lib");
    let header = include.join("rime_api.h");

    let use_real = header.is_file() && has_librime_lib(&lib);

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let source = if use_real {
        manifest.join("src/shim.c")
    } else {
        manifest.join("src/shim_stub.c")
    };
    let object = out_dir.join("shim.o");
    let archive = out_dir.join("libqieyun_shim.a");

    // C 编译器：优先 $CC，其次 cc（macOS 上是 clang 的别名），最后 clang。
    let compiler = env::var("CC").unwrap_or_else(|_| {
        if Command::new("cc")
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            "cc".into()
        } else {
            "clang".into()
        }
    });
    let mut cc = Command::new(compiler);
    cc.arg("-O2").arg("-fPIC").arg("-c").arg(&source);
    if use_real {
        cc.arg("-I").arg(&include);
    }
    cc.arg("-o").arg(&object);
    run(&mut cc, "编译 shim");

    let mut ar = Command::new(env::var("AR").unwrap_or_else(|_| "ar".into()));
    ar.arg("crs").arg(&archive).arg(&object);
    run(&mut ar, "打包 shim 静态库");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=qieyun_shim");

    if use_real {
        println!("cargo:rustc-link-search=native={}", lib.display());
        println!("cargo:rustc-link-lib=dylib=rime");
        // macOS：让测试/二进制无需手动设置 DYLD_LIBRARY_PATH
        if cfg!(target_os = "macos") {
            println!("cargo:rustc-link-arg=-Wl,-rpath,{}", lib.display());
        }
        println!("cargo:rustc-cfg=librime_linked");
    } else {
        println!(
            "cargo:warning=未找到 librime（{}），qieyun-ffi 使用 stub；进程内引擎不可用",
            dist.display()
        );
    }

    println!("cargo:rustc-check-cfg=cfg(librime_linked)");
    println!("cargo:rerun-if-changed=src/shim.c");
    println!("cargo:rerun-if-changed=src/shim_stub.c");
    println!("cargo:rerun-if-env-changed=LIBRIME_DIST");
}

fn has_librime_lib(lib: &std::path::Path) -> bool {
    ["librime.1.dylib", "librime.dylib", "librime.so", "rime.lib"]
        .iter()
        .any(|name| lib.join(name).is_file())
}

fn run(cmd: &mut Command, what: &str) {
    let status = cmd.status().unwrap_or_else(|e| panic!("{what} 失败：{e}"));
    assert!(status.success(), "{what} 失败，退出码 {status}");
}
