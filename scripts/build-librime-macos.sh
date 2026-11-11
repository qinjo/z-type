#!/usr/bin/env bash
# 构建 librime（macOS），产出与 Squirrel 相同的布局：
#   <librime>/dist/lib/librime.1.dylib
#   <librime>/dist/include/rime_api.h
#
# 依赖：Xcode Command Line Tools、cmake、make。
# 参考 rust 绑定：crates/rime-kit 不使用 FFI，FFI 在 apps/desktop/src-tauri。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIBRIME_DIR="${LIBRIME_DIR:-$ROOT/.deps/librime}"
LIBRIME_REF="${LIBRIME_REF:-1.17.0}"

mkdir -p "$(dirname "$LIBRIME_DIR")"
if [ ! -d "$LIBRIME_DIR/.git" ]; then
  git clone --depth 1 --branch "$LIBRIME_REF" https://github.com/rime/librime.git "$LIBRIME_DIR"
fi
cd "$LIBRIME_DIR"

# 依赖（marisa / leveldb / opencc / yaml-cpp）走 librime 自带 Makefile 的 deps 目标
make deps

# 产出一个共享库 + 头文件；GUI 与外壳都链接这一份
make release
make install

echo "✅ librime 构建完成：$LIBRIME_DIR/dist"
echo "   供 Rust 绑定使用："
echo "   export LIBRIME_INCLUDE_DIR=$LIBRIME_DIR/dist/include"
echo "   export LIBRIME_LIB_DIR=$LIBRIME_DIR/dist/lib"
