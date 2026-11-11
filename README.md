# 切韵 · Qieyun（仓库代号 z-type）

一个**把 Rime 配置变简单**的跨平台输入法项目：内核用官方 [librime](https://github.com/rime/librime)，
外壳 fork 自 [Squirrel](https://github.com/rime/squirrel)（macOS）与 [Weasel](https://github.com/rime/weasel)（Windows），
再配一个**可视化配置工作台**——改主题、键位、模糊音、双拼、标点、词典，改完立刻校验、部署、生效。

- Rime 支持的功能，这里都支持（方案、词典、Lua 扩展、同步、插件）。
- 手改 YAML 永远有效：GUI 只写 `*.custom.yaml` 的 patch 层，只碰自己声明拥有的键。
- 配置有快照、可回滚；漂移检测避免覆盖你的手工修改。
- 许可证：GPL-3.0（与两端外壳上游一致）。

## 现在是什么状态

**M1/M2 阶段**：架构与决策定稿；`crates/qieyun-kit` 覆盖写回/托管键/漂移检测/主题编译/快照/接管；
Tauri 后端打通环境探测、方案扫描、部署（rime_deployer）、主题应用、首启接管；
GUI 的概览与外观页已接真实数据，其余页面仍是占位。平台外壳（Squirrel/Weasel fork）尚未接入。
契约测试可在真实 librime 上验证"GUI 写出的 patch 确实生效"。见 [roadmap](docs/roadmap.md)。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `crates/qieyun-kit/` | 领域核心（纯 Rust，无 FFI）：写回引擎、主题编译、模糊音、快照、重载计划 |
| `apps/desktop/` | Tauri 2 + React 配置工作台 |
| `platform/macos/` | fork 的 Squirrel（git subtree，尚未接入） |
| `platform/windows/` | fork 的 Weasel（git subtree，尚未接入） |
| `docs/` | [架构](docs/architecture.md) · [ADR](docs/adr/) · [Roadmap](docs/roadmap.md) · [事实笔记](docs/research/rime-facts.md) |
| `patches/` | 对上游外壳的改动登记（升级上游时唯一真相） |

## 快速开始

```bash
# 领域核心：不需要 librime，任意平台可跑
cargo test

# 配置 GUI（无需 Rust 侧即可构建前端）
cd apps/desktop && pnpm install && pnpm build && pnpm dev
```

接入平台外壳（M0 后半段）：

```bash
./scripts/build-librime-macos.sh  # 准备 librime（官方预编译包，秒级）
QIEYUN_RIME_DEPLOYER="$PWD/.deps/librime-prebuilt/dist/bin/rime_deployer" \
  cargo test -p qieyun-kit --test deploy_contract   # 契约测试
cd apps/desktop && pnpm tauri dev                   # 启动 GUI
```

## 设计要点（三句话）

1. **只写 custom 层**：`*.custom.yaml` 的 `patch` 是 Rime 的官方覆盖层，GUI 不碰方案原文。
2. **文本级写回**：不做 parse/serialize，注释与未托管键逐字节保留；托管键清单 + 哈希做漂移检测。
3. **内嵌 librime**：保存前校验、保存后部署、改完能预览——这才是"可视化"相对文本编辑器的价值。

详细契约见 [docs/architecture.md](docs/architecture.md)。

## 许可证

GPL-3.0-or-later。内核 librime 为 BSD-3-Clause，外壳上游为 GPL-3.0。
