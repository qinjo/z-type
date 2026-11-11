# platform/macos —— fork 的 Squirrel（尚未接入）

## 接入

```bash
git subtree add --prefix=platform/macos https://github.com/rime/squirrel.git \
  <pin 到某个 tag/commit> --squash
```

> 首次接入后请把 commit/tag 写进 `docs/research/rime-facts.md` 与 `scripts/bootstrap-subtrees.sh`。

## 我们计划的最小改动面

1. 品牌资源与 bundle id（`com.ztype.rime-studio`）、产品名、图标。
2. 安装器（`package/`）：改为单 pkg 同装输入法与本项目的 GUI App。
3. 默认配置模板（随包分发，首次安装时写入用户的共享目录）。
4. 如需：增加一个稳定的重载入口（当前 `--reload` 已够用，见 ADR-0008）。

## 不要做的事

- 不要改 librime 的内部行为（我们是黑盒链接）。
- 不要改 Squirrel 的输入法协议语义（组合、候选、提交），那会破坏与其它 Rime 前端的互操作。
