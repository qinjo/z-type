# 架构设计：切韵

> 对外品牌 **切韵 / Qieyun**（仓库代号 `z-type`）。本文是整个项目的技术契约：任何实现与其冲突时，改实现或先改本文 + 对应 ADR。

## 1. 目标与非目标

**目标**

- macOS 与 Windows 上各自有一个可日常使用的输入法外壳，内核是**官方 librime**，Rime 支持的功能一律支持（方案、模糊音、双拼、Lua 扩展、用户词典、同步、主题）。
- 提供一个跨平台的**可视化配置工作台**，覆盖 Rime 最常改、最容易改错的配置，改完立刻预览、校验、部署。
- 用户手改 YAML 永远仍然有效；GUI 与手改共存，不抢文件、不炸配置。

**非目标**

- 不重写/不 fork librime 内核（不做新引擎、不改算法）。
- 首版不做 Linux、不做移动端。
- 不做"图形化编辑 schema 的 processor/segmentor pipeline"（无底洞，交给 YAML + 诊断）。
- 不做云端方案市场/账号体系。

## 2. 总体架构

```
┌──────────────────────────── 切韵 (Tauri 2) ────────────────────────────┐
│  React + TS 前端（10 个页面）                                                   │
│        │  invoke (typed IPC, 无 window.__TAURI__ 时降级为 mock)                 │
│  src-tauri：命令层（薄）                                                         │
│        │                                                                        │
│  crates/qieyun-kit（纯 Rust 领域核心，可单测）                                      │
│   ├─ patch    文本级写回引擎 + 托管键清单 + 漂移检测                              │
│   ├─ theme    统一主题模型 → squirrel / weasel 双端编译                           │
│   ├─ fuzzy    模糊音预设 → speller/algebra 规则                                  │
│   ├─ schema   方案/键盘/标点的类型化模型                                          │
│   ├─ snapshot 备份、回滚                                                         │
│   └─ reload   部署编排 + 平台重载适配器接口                                       │
│        │                                                                        │
│  librime（内嵌，librime-sys 绑定）：校验、预览、deploy、配置读写、词库管理          │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │ 读写用户 Rime 目录（~/Library/Rime、%APPDATA%\Rime）
                                │ + 部署后通知外壳重载
              ┌─────────────────┴──────────────────┐
   platform/macos（fork Squirrel, Swift/IMK）  platform/windows（fork Weasel, C++/TSF）
              │ 各自链接各自那份 librime            │
              └─────────────────┬──────────────────┘
                        用户 Rime 用户目录（唯一真值）
```

**关键不变量**

1. 用户目录是唯一真值；GUI 不维护影子副本。
2. GUI 只写 `*.custom.yaml`，且只写自己声明拥有的键（见 §4）。
3. 任何写入前必有快照；写入必须原子。
4. 部署与重载是两个动作，可分别重试；任一失败要给出可执行的人工兜底步骤。

## 3. 仓库结构

```
z-type/
├── Cargo.toml                  # Rust workspace（members = crates/*）
├── crates/qieyun-kit/            # 领域核心（本仓库自研，BSD 兼容地独立可测）
├── apps/desktop/               # Tauri 2 应用：src-tauri + React 前端
├── platform/macos/             # git subtree：rime/squirrel 的 fork
├── platform/windows/           # git subtree：rime/weasel 的 fork
├── patches/                    # 我们对上游的补丁说明与导出 diff（见 §8）
├── docs/                       # 架构、ADR、roadmap
├── scripts/                    # bootstrap / build-librime / release
└── .github/workflows/          # CI
```

依赖方向：`apps/desktop` → `qieyun-kit`；`platform/*` 不依赖 Rust 侧；三者仅通过"用户目录里的文件 + reload 通知"耦合。

## 4. 配置数据模型与写回契约（本项目最核心的设计）

### 4.1 Rime 的配置分层

- 共享目录（如 `/Library/Application Support/Rime`、Weasel 安装目录下 `data`）提供方案与词库原文。
- 用户目录提供 `*.custom.yaml`，按 `patch` 语义覆盖共享配置。
- `deploy` 把 YAML + 词典编译成 `build/*.bin`。

因此**正确的写入面只有 `*.custom.yaml`**。GUI 不碰 `.schema.yaml`、不碰 `build/`、不碰 `*.userdb`。

### 4.2 文件所有权清单

| 文件 | GUI 是否写 | 说明 |
|---|---|---|
| `default.custom.yaml` | 写 | 方案列表、键位、候选数量、快捷键 |
| `squirrel.custom.yaml`（macOS） | 写 | 主题、样式 |
| `weasel.custom.yaml`（Windows） | 写 | 主题、样式 |
| `<schema>.custom.yaml` | 写 | 模糊音（`speller/algebra`）、标点等方案级配置 |
| `<schema>.schema.yaml`、`*.dict.yaml` | 只读 | 共享目录里的内容 |
| `installation.yaml` | 只读（v1） | 仅用于读取同步目录 |
| `build/**`、`*.userdb/**` | 不碰 | 由 librime 与同步机制管理 |
| `user.yaml` | 只读 | Rime 自己的状态记录 |

### 4.3 托管键（managed keys）

GUI 在用户目录下维护 `.qieyun/state.json`：

```json
{
  "schema_version": 1,
  "files": {
    "squirrel.custom.yaml": {
      "keys": {
        "style/color_scheme": { "hash": "sha256:...", "written_at": "..." },
        "style/font_point":   { "hash": "sha256:...", "written_at": "..." }
      }
    }
  }
}
```

规则：

- **只有出现在 state.json 里的键才算 GUI 拥有**。其余键（包括用户手写的）一律原样保留。
- 每次写入：更新值 → 更新 hash → 记 `written_at`。
- 用户取消某个选项 → 从文件里删除该键，并从 state.json 移除。
- 文件里存在但 state.json 没有的键：GUI 视为"用户的"，只读展示，绝不改。

### 4.4 写回算法：文本级行编辑，而不是反序列化重写

**禁止** `parse → mutate → serialize` 整个文件：`serde_yaml` 会丢注释、重排键序，而 Rime 用户的 YAML 大量依赖注释和 `__include` 顺序。实现走"行级手术"：

```
apply_edits(text, edits) -> new_text
  1. 定位顶层 `patch:` 行（允许文件不存在/为空 → 生成文件头）
  2. 计算 patch 映射块的行范围 [start, end)
  3. 对每个 edit:
     a. 在块内按 1 级缩进查找 `<key>:` 行（key 是 Rime 的斜杠路径，如 style/font_point）
     b. Set:
        - 找到 → 删除原 key 行及其续行（缩进 > 1 的行），插入新行
        - 未找到 → 在块尾（最后一行非空内容之后）追加
     c. Remove: 删除 key 行及其续行
  4. 未触及的行逐字节保留（含注释、空行、行尾空格）
```

值渲染规则：

- 标量 → `  <key>: <scalar>`（字符串按需加引号，用 serde_yaml 的标量渲染）。
- 序列/映射 → `  <key>:` 换行 + 该值的 YAML 块整体缩进 2 空格。
- 序列一律用块形式 `- item`，不用流式 `[a, b]`，便于 diff 与手改。

**幂等性要求**：同一份 edits 应用两次，第二次产出必须与第一次完全一致（golden test 覆盖）。

### 4.5 漂移检测与冲突处理

写入前，对每个托管键比较"文件里当前值的 hash"与 state.json 里记录的 hash：

- 一致 → 正常覆盖。
- 不一致 → 说明用户手改过这个键。默认**不覆盖**，UI 弹出冲突项：保留我的 / 用 GUI 的值 / 查看差异。批量操作时若有冲突，整批中止并进入冲突解决页。
- 键在文件里不存在 → 视为 GUI 自增，直接插入。

这把"GUI 与手改共存"从口号变成了可验证的行为。

### 4.6 原子写与快照

- 写入：写临时文件 → fsync → `rename` 覆盖（同目录，保证原子）；失败回滚。
- 写前快照：`.qieyun/snapshots/<ISO8601>/`，只复制配置类文件（`*.yaml`、`*.txt`、`installation.yaml`），排除 `build/`、`*.userdb/`、`plum/`。
- 快照保留最近 N 份（默认 20）+ 每次"批量修改"另存一份；支持从快照一键恢复（恢复前再存一份当前状态）。

## 5. 主题模型与双端编译

### 5.1 统一模型（单一真值）

```rust
struct Theme {
  name: String,
  font: Font { face: String, point: u16, label_point: u16, line_spacing: u16 },
  colors: Colors {   // 全部为 RGBA，不暴露平台编码
    back, border, text, candidate_text, comment_text,
    hilited_back, hilited_text, hilited_candidate_back,
    hilited_candidate_text, hilited_candidate_border, hilited_border,
  },
  layout: Layout {
    orientation: Horizontal | Vertical,
    candidate_count: u8,
    corner_radius: u16, border_width: u16, margin: u16, spacing: u16, shadow: u16,
  },
  platform_specific: { macos: Map, windows: Map },  // 折叠区的自由键
}
```

### 5.2 编译目标

两端配色都按 **ABGR** 解析（`0xAABBGGRR`；6 位时按 `BBGGRR`），所以 `Rgba::to_abgr()` 是唯一换算点。字段差异：

| 统一字段 | Squirrel（macOS） | Weasel（Windows） |
|---|---|---|
| 颜色方案名 | `style/color_scheme` | `style/color_scheme` |
| 各颜色 | `preset_color_schemes/<name>/back_color` 等 | 同左（键名基本一致） |
| 字体 | `style/font_face`、`style/font_point` | `style/font_face`、`style/font_point` |
| 横竖排 | `style/candidate_list_layout: linear\|stacked`、`text_orientation` | `style/horizontal: true\|false` |
| 圆角 | `style/corner_radius` | `style/layout/corner_radius`（旧名 `round_corner`） |
| 边框 | `style/border_width`、`border_height` | `style/layout/border_width` |
| 边距/间距 | `style/spacing`、`line_spacing` | `style/layout/margin_x`、`margin_y`、`spacing`、`linespacing` |
| 阴影 | `style/shadow_size` | `style/layout/shadow_radius`、`shadow_offset_x/y` |
| 候选数 | `menu/page_size`（方案级） | 同左 |

> 该表以 2026-11 源码为准（见 `docs/research/rime-facts.md`）；M2 里程碑用契约测试锁定：编译产物喂给 librime 部署后，读回 build 产物断言字段存在且值正确。

编译器输出示例（macOS）：

```yaml
patch:
  style/color_scheme: ztype_dark
  preset_color_schemes/ztype_dark:
    name: Qieyun Dark
    back_color: 0x1E1E1E
    text_color: 0xE6E6E6
    ...
```

### 5.3 降级与"仅本端"字段

- 交集之外的字段放 `platform_specific`，UI 用折叠区标注"仅 macOS 生效"。
- 目标文件属于另一平台时（在 macOS 上编辑 Windows 主题，或反之），UI 允许编辑但标注"跨端预览需在目标端部署"。

## 6. 部署与重载协议

### 6.1 时序

```
用户点「保存并应用」
  → 快照
  → 计算 edits → 漂移检查（有冲突则中止）
  → 原子写入 *.custom.yaml
  → 内嵌 librime：deployer_initialize() → deploy()   （生成 build/）
  → 通知外壳重载
  → 报告结果（成功 / 部分失败 / 需手动操作）
```

### 6.2 平台差异（关键事实）

| | macOS（Squirrel fork） | Windows（Weasel fork） |
|---|---|---|
| 重载通道 | `DistributedNotificationCenter` 通知名 `SquirrelReloadNotification`；由 `Squirrel --reload` 投递 | `WeaselIPC` 命令枚举里**没有** deploy；官方部署入口是 `WeaselDeployer.exe /deploy` |
| 采用方案 | spawn 应用可执行文件带 `--reload` | spawn `WeaselDeployer.exe /deploy`（内部 `StartMaintenance→deploy→EndMaintenance`） |
| 退路 | 若 spawn 失败 → 提示用户在输入法菜单点「重新部署」 | 同 |

**为什么不自己改 IPC 加命令**：改协议会让"GUI 版本"和"外壳版本"必须严格同版本，拖累灰度；复用官方入口能保证用户看到的部署结果与 GUI 预览一致。这是 ADR-0008 的决定。

### 6.3 并发与锁

- GUI 侧对"部署"动作加进程内互斥 + 用户目录下 `.qieyun/deploy.lock`（PID + 时间戳，超时 120s 视为陈旧锁）。
- 部署期间输入法仍在接受输入（同一用户），librime 允许读 build 产物时被替换；Windows 走 WeaselDeployer 时由其维护维护模式，风险最低。
- 部署失败时**不回滚已写入的 YAML**（用户可能只想改文件），但 UI 明确提示"文件已改、部署失败"，并提供"回滚到上一快照"按钮。

## 7. librime 嵌入与 Rust 绑定

**绑定**：`librime-sys` 0.5.0（Rime 作者 lotem 维护，2026-11 更新）+ `qieyun-kit` 之上的安全封装。不采用 `rime-api`（2024 停更）。

**暴露面（最小）**：`setup/initialize/finalize`、session 生命周期、`get_commit/get_context/select_candidate`、`config_*` 读写、`deployer_initialize/deploy`、`user_dict`/`sync`。

**构建链**（跟随上游，不搞统一 superbuild）：

- macOS：照 Squirrel 的 `lib/Makefile` —— deps（marisa/leveldb/opencc/yaml-cpp）编静态库，librime 出 `librime.1.dylib` 放 `Frameworks/`，`CodeSignOnCopy` + `disable-library-validation`。
- Windows：照 Weasel —— 静态链 `rime.lib`。
- librime 版本通过 git submodule pin 到同一个 commit，双端一致。
- `qieyun-kit` 不依赖 FFI：领域逻辑纯 Rust 可测；FFI 只在 `apps/desktop/src-tauri` 与外壳里。

## 8. 平台外壳 fork 与上游同步

- `platform/macos`、`platform/windows` 用 `git subtree` 引入上游，允许直接改。
- 我们对上游的每处改动必须在 `patches/` 有记录（导出 `.patch` + 一句话动机），否则视为违规。
- 升级上游：`git subtree pull` → 按 `patches/` 逐条 rebase → CI 编出双端 → 冒烟清单。
- 外壳最小改动面：品牌资源与 bundle id、安装器、reload 入口（如需）、默认配置。

## 9. 打包、签名、分发

- macOS：单个 pkg 同装 IME（`/Library/Input Methods/切韵.app`）与 GUI（`/Applications/切韵.app`）；`pkgbuild` + `productbuild`（多 pkg-ref）+ `productsign` + `notarytool`。必须 Developer ID；未签名在 macOS 13+ 基本不可用（26 上直接拦）。
- Windows：NSIS 单包同装 WeaselTSF DLL + WeaselServer + GUI；v1 不签名，接受 SmartScreen 提示。
- 自动更新：v1 不做（Squirrel 自带 Sparkle，可后续接入）。

## 10. 故障处理清单

| 现象 | 处理 |
|---|---|
| YAML 写坏导致部署失败 | 部署前用 librime 校验；失败给出"第 N 行/哪个键"定位；一键回滚 |
| 输入法卡死/无候选 | GUI 提供"重启输入法"（macOS 重建 IME 进程；Windows 重启 WeaselServer），并附日志 |
| 用户目录被其他工具改 | 漂移检测 + 冲突页 |
| 共享目录缺失/方案未装 | 概览页体检项 + 引导安装 plum/rime-ice |
| 旧版本 GUI 写的 state.json | `schema_version` 迁移；无法迁移时只读模式 |

## 11. 测试策略

1. **golden test**（`qieyun-kit`）：写回幂等、注释与未托管键逐字节保留、缩进/序列/引号渲染。
2. **契约测试**（CI，macOS job）：`qieyun-kit` 产出真实配置 → 内嵌 librime 部署 → 读回 `build/` 断言 patch 生效。这是唯一能证明"GUI 产出语义正确"的测试。
3. **UI 测试**：关键流程（首启接管、主题保存、冲突解决、回滚）用 Playwright/WebDriver 驱动 Tauri。
4. **冒烟清单**（手工，每次发版）：输入、候选、翻页、中英切换、特殊符号、模糊音生效、双拼生效、主题生效、同步。

## 12. 已知风险

- **librime 双实例**：GUI 与输入法进程各持一份 librime，同时写 `build/` 可能短暂不一致 → 用部署锁 + 官方部署入口收敛。
- **TSF/IMK 的边界情况**：靠 fork 上游规避，但改外壳时仍需真机回归。
- **配色字段漂移**：上游改字段名会让主题编译静默失效 → 契约测试锁定 + 诊断页比对。
- **macOS 安装权限**：pkg 需 admin，用户可能拒绝 → 文档写清。

## 13. 未决

- 是否在 v2 接 Sparkle 自动更新、是否支持 Linux（fcitx5-rime 用户可复用同一份配置）。

## 14. 安全加固（2026-11-12 外部审查后的修订）

以下几条已从"约定"变成"代码保证 + 回归测试"：

| 问题 | 修订 |
|---|---|
| 未托管键被静默覆盖 | `State::detect_unmanaged` + `ConflictPolicy::Abort`（默认中止）/`Adopt`（用户确认后接管）。文件里有、`state.json` 未登记的键一律不得改写 |
| 块值含空行时写回损坏 | `find_key` 续行判定改为"跳过空行/注释看缩进"，不再遇空行即停；4 条 golden test 覆盖空行、注释、块尾注释、追加 patch 块 |
| `Session` 生命周期未绑定引擎 | `Session<'a>` + `PhantomData<&'a mut Engine>`，`drop(engine)` 在会话存活期间编译失败（`compile_fail` doctest 守护） |
| 读取失败被当成空文件 | 只有 `NotFound` 视为空；权限/编码错误以 `WriteError::Read` 中止 |
| 多文件写入非事务 | 落盘阶段失败或 `state.json` 保存失败 → 按写前内容回滚已写文件（原先不存在的则删除） |
| 快照恢复的备份是 best-effort | 备份失败即中止恢复；恢复后重建托管键哈希，避免下一次写入误判漂移 |
| 子进程部署不落日志 | 统一 `write_deploy_log`，进程内/子进程两条路径都写 `last-deploy.log` |
| 部署锁可双重通过 | `create_new` 原子创建 + 唯一 token；只有 token 匹配才删除锁；陈旧锁 120s 可抢占 |
| 符号链接逃逸用户目录 | `within_user_dir` 对**目标本身**也 canonicalize，识别指向外部的链接 |
| `schema_id` 未校验 | `is_valid_schema_id`：单段文件名、禁止 `/ \\ ..`，非法 id 直接视为不存在 |
| 快照无限增长 | 创建后 `prune(DEFAULT_KEEP=20)`；快照排除 `*.dict.yaml` / `*.userdb.txt`（GUI 从不修改、体积大） |
| `CreatePolicy::Create` 语义不全 | 非空但没有 `patch:` 块的文件会在文末追加块，保留原有内容与注释 |

### 冲突策略的最终语义

`ConflictPolicy` 同时管两类冲突，且 `Adopt` 对两者都生效（这是审查后修正的关键点：

| 冲突 | Abort（默认） | Adopt（用户确认覆盖） |
|---|---|---|
| 未托管键（文件里有、state 未登记） | 拒绝，文件不动 | 先把旧值登记为基线，再写入 |
| 漂移（已托管但被手改） | 拒绝，文件不动 | 先把当前值重新登记为基线，再覆盖 |

覆盖后哈希已更新，后续普通写入不会再误判漂移（`adopt_can_override_drift` 测试守护）。

### 错误契约

写命令返回结构化错误，前端据此弹确认框而不是把中文文案当字符串匹配：

```json
{ "code": "conflict", "message": "...", "conflict": { "kind": "unmanaged|drift", "file": "...", "keys": ["..."] } }
```

前端同时保留"文案解析"回退路径，以兼容未升级的后端。
