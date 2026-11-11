#!/usr/bin/env bash
# 准备 librime（macOS）。默认走官方预编译包（秒级），失败再回退源码构建。
#
#   ./scripts/build-librime-macos.sh            # 预编译包（推荐）
#   ./scripts/build-librime-macos.sh --source   # 从源码构建（需要 cmake，慢）
#
# 产物布局（与 Squirrel 一致）：
#   .deps/librime-prebuilt/dist/lib/librime.1.dylib
#   .deps/librime-prebuilt/dist/bin/rime_deployer
#   .deps/librime-prebuilt/dist/include/rime_api.h
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIBRIME_VERSION="${LIBRIME_VERSION:-1.17.0}"
# 官方 release 的资源名带 commit 前缀，换成新版本时同步更新这里。
LIBRIME_ASSET="${LIBRIME_ASSET:-rime-33e7814-macOS-universal.tar.bz2}"
PREBUILT_DIR="$ROOT/.deps/librime-prebuilt"
DIST="$PREBUILT_DIR/dist"

if [ "${1:-}" != "--source" ]; then
  if [ -x "$DIST/bin/rime_deployer" ]; then
    echo "✅ 已存在预编译 librime：$DIST（跳过下载）"
    exit 0
  fi
  echo "→ 下载官方预编译包 $LIBRIME_VERSION / $LIBRIME_ASSET"
  mkdir -p "$PREBUILT_DIR"
  curl -fL --retry 3 --max-time 300 \
    -o "$PREBUILT_DIR/$LIBRIME_ASSET" \
    "https://github.com/rime/librime/releases/download/${LIBRIME_VERSION}/${LIBRIME_ASSET}"
  tar -xjf "$PREBUILT_DIR/$LIBRIME_ASSET" -C "$PREBUILT_DIR"
  echo "✅ 预编译 librime 就绪：$DIST"
  echo "   rime_deployer 依赖 @rpath，运行时需要："
  echo "   export DYLD_LIBRARY_PATH=$DIST/lib"
  exit 0
fi

# ---- 源码构建（备选） ----
if ! command -v cmake >/dev/null 2>&1; then
  cat >&2 <<'MSG'
❌ 缺少 cmake（librime 的 deps 目标要用它构建 glog/leveldb/marisa/opencc/yaml-cpp）。

    brew install cmake

装完重跑本脚本即可（已 clone 的 .deps/librime 会被复用）。
MSG
  exit 1
fi

LIBRIME_DIR="${LIBRIME_DIR:-$ROOT/.deps/librime}"
if [ ! -d "$LIBRIME_DIR/.git" ]; then
  git clone --depth 1 --branch "$LIBRIME_VERSION" https://github.com/rime/librime.git "$LIBRIME_DIR"
fi
cd "$LIBRIME_DIR"
make deps
make release
make install
echo "✅ 源码构建完成：$LIBRIME_DIR/dist"
echo "   export LIBRIME_INCLUDE_DIR=$LIBRIME_DIR/dist/include"
echo "   export LIBRIME_LIB_DIR=$LIBRIME_DIR/dist/lib"
