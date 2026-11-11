# patches/

我们对上游外壳（`platform/macos` ← rime/squirrel，`platform/windows` ← rime/weasel）的**每一处改动**都必须在这里登记。

## 规则

1. 每处改动一个 `.patch` 文件，文件名 `<vendor>-<序号>-<简述>.patch`，例如 `squirrel-0001-rebrand-bundle-id.patch`。
2. 同目录的 `NOTES.md` 记录每条补丁的动机、影响文件、以及对上游的行为差异。
3. 未登记的工作区差异视为违规；CI 会尝试 `git diff --stat` 对照（M7 起强制执行）。
4. 升级上游时：`git subtree pull` → 按目录逐条 rebase → 双端编出产物 → 过一遍手工冒烟清单。

## 当前补丁

（尚未接入上游，接入后在此登记）
