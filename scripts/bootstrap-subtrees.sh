#!/usr/bin/env bash
# 把两端上游外壳接入为 git subtree。
#
# 首次运行前请把 *_REF 固定到具体 tag/commit（不要用 master），
# 并在 docs/research/rime-facts.md 记录 pin 的版本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SQUIRREL_URL="${SQUIRREL_URL:-https://github.com/rime/squirrel.git}"
WEASEL_URL="${WEASEL_URL:-https://github.com/rime/weasel.git}"
# ⚠️ 占位：接入时替换为具体 tag/commit
SQUIRREL_REF="${SQUIRREL_REF:-master}"
WEASEL_REF="${WEASEL_REF:-master}"

if [ "$SQUIRREL_REF" = "master" ] || [ "$WEASEL_REF" = "master" ]; then
  echo "⚠️  仍在使用 master。发布前请 pin 到 tag/commit。" >&2
fi

add() {
  local prefix="$1" url="$2" ref="$3"
  if [ -d "$prefix" ] && [ -n "$(ls -A "$prefix" 2>/dev/null)" ]; then
    echo "跳过 $prefix（已存在且非空）"
    return
  fi
  echo "→ 接入 $url@$ref 到 $prefix"
  git subtree add --prefix="$prefix" "$url" "$ref" --squash
}

add platform/macos "$SQUIRREL_URL" "$SQUIRREL_REF"
add platform/windows "$WEASEL_URL" "$WEASEL_REF"

cat <<'NOTE'

下一步（手工）：
1. 把 pin 的 commit 写进 docs/research/rime-facts.md。
2. 在 patches/ 建立第一条补丁登记（品牌/安装器改动）。
3. macOS：./scripts/build-librime-macos.sh
NOTE
