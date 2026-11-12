# 切韵 · 桌面前端骨架（M0）

跨平台 Rime 输入法可视化配置工作台的前端外壳。技术栈：**Tauri 2 + React 19 + TypeScript + Vite 6 + Tailwind CSS 3**。

本目录是前端工作区，**前端构建（`pnpm build`）完全不依赖 Rust / Cargo**：`src/lib/ipc.ts` 会检测 Tauri 运行时，缺失时自动降级为 mock 数据。首启接管、外观主题、方案与启用、按键、模糊音、双拼、标点、词典、诊断与日志已接入真实 Tauri 命令（`get_takeover_plan` / `accept_takeover` / `list_theme_presets` / `apply_theme` / `scan_profile` / `get_input_settings` / `apply_input_settings` / `apply_and_deploy` / `get_schema_detail` / `get_fuzzy_settings` / `apply_fuzzy_settings` / `run_diagnostics` / `get_dict_inventory` / `read_deploy_log` / `restore_snapshot` / `reveal_path` / `list_user_files` / `write_raw_file` / `reset_managed_keys` / `clear_deploy_lock` / `parse_deploy_log` / `engine_status` / `preview_typing` / `preview_commit` / `deploy_in_process` / `shutdown_engine`），10 个页面均已接线，无占位页。外观页候选窗预览可切到「真实引擎候选」、概览页新增「试打字」面板（输入拼音 → 真实候选 → 上屏），两者在未链接 librime 的 stub 构建下都会优雅降级。四个写命令（`write_gui_config` / `apply_theme` / `apply_input_settings` / `apply_fuzzy_settings`）默认拒绝覆盖用户手写 / 被手改的键，并以结构化 `CommandError` 返回冲突；前端用 `toCommandError()` / `parseWriteConflict()` + `ConflictDialog` + `guiWrite.ts` 的接缝统一做「保留我的 / 用切韵的值覆盖（adopt 重放）」，外观页、方案与启用、按键、双拼、模糊音五个页面的写操作都接在这条链路上。

## 快速开始

```bash
cd apps/desktop
pnpm install          # 只在 apps/desktop 内安装，不会创建根级 node_modules / lockfile
pnpm dev              # Vite dev server → http://localhost:1420
pnpm build            # tsc --noEmit && vite build，产物在 dist/
pnpm typecheck        # 仅类型检查
pnpm preview          # 预览 dist/
```

接入 Tauri（需要 Rust 工具链，本阶段不要求执行）：

```bash
pnpm tauri dev        # 由 src-tauri/tauri.conf.json 驱动，beforeDevCommand = pnpm dev
pnpm tauri build      # 打包（需要图标/签名等发布配置）
```

## 实际构建验证（2026-11-11，macOS 15.4.1 / Node v20.19.0 / pnpm 10.32.1）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0，~2m43s | registry 为 npmmirror，有重试但最终完成；pnpm 10 默认忽略 esbuild 的 build script，不影响本仓库构建（esbuild 走平台二进制包） |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `53 modules transformed`；产物 `dist/index.html` 0.56 kB、CSS 20.31 kB、JS 287.46 kB（gzip 87.09 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |
| `pnpm dev` 冒烟 | ✅ HTTP 200 | 端口 1420 固定（strictPort），`/` 与 `/src/main.tsx` 均正常响应 |

> 未执行 `cargo build` / `pnpm tauri build`：`src-tauri/` 只是最小可编译占位工程，Cargo workspace 由 lead 统一处理。

### 前端接线后复验（2026-11-11 晚，首启接管 + 外观主题）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | lockfile 未变，`Already up to date`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `59 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 20.33 kB、JS 305.59 kB（gzip 92.63 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |

> 本轮只改 `apps/desktop/src/**` 与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 方案与按键接线后复验（2026-11-11 晚）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date` / `Already up to date`，pnpm 10 忽略 esbuild build script 的警告依旧存在 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `59 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 20.33 kB、JS 317.48 kB（gzip 94.77 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |

> 本轮同样只改 `apps/desktop/src/**` 与本 README（`ipc.ts`、`Schemas.tsx`、`KeyBindings.tsx`），未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 模糊音 / 双拼 / 标点接线后复验（2026-11-11 晚）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date` / `Already up to date`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `60 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 20.57 kB、JS 338.04 kB（gzip 98.96 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |
| mock 流程冒烟（vite `ssrLoadModule` + `node:assert`） | ✅ | 7 个模糊音组、≥2 个双拼方案、`half_shape`/`full_shape` 示例；`apply_fuzzy_settings` 重复应用幂等、清空后回到原始 algebra；`apply_input_settings` 后 `scan_profile` 的默认方案同步变化 |

> 本轮只改 `apps/desktop/src/**` 与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 词典 / 诊断与日志接线后复验（2026-11-12）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date` / `Already up to date`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `61 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 20.91 kB、JS 353.26 kB（gzip 102.01 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |
| mock 流程冒烟（vite `ssrLoadModule` + `node:assert`） | ✅ | 诊断初始 3 通过 / 1 提醒 / 1 失败且提醒与失败均带 hint；词典盘点 2 dict + 1 userdb + sync_dir；`create_snapshot` 写入列表、`restore_snapshot` 返回 3 个恢复文件并自动追加「恢复前自动备份」快照；`apply_and_deploy` 后日志存在且体检的 build 检查由 warn 转 ok（4/0/1） |

> 本轮只改 `apps/desktop/src/**` 与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 高级页（原始编辑 + 危险操作）/ 部署错误解析接线后复验（2026-11-12）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Done in 947ms`，`Lockfile is up to date`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `61 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 22.13 kB、JS 375.80 kB（gzip 108.22 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict 模式，无错误 |
| mock 流程冒烟（vite `ssrLoadModule` + `node:assert`） | ✅ | 文件清单 5 项且 dict / installation 为 `editable=false`；`read_file` 按文件名命中；`write_raw_file` 返回 `snapshot_id` 且字节数正确、写后 `read_file` 读到新内容并新增一条快照；非法文件名 / dict / Tab 缩进 / 括号未闭合四类错误均原样抛出且**不落盘**；`reset_managed_keys` / `clear_deploy_lock` 首次 `removed=true`、再次 `false`；`parse_deploy_log` 部署前 1 error（`missing input schema: ghost` + hint + source）+ 1 warning + 2 条 unparsed，`apply_and_deploy` 后 errors/warnings 归零且体检 build 检查转 ok |
| 页面 SSR 渲染冒烟（`react-dom/server`） | ✅ | `Advanced` 6168 B / `Diagnostics` 7390 B，均渲染出「文件清单 / 原始编辑器 / 危险操作 / 部署错误解析」等关键区块 |

> 本轮只改 `apps/desktop/src/**`（`lib/ipc.ts`、`pages/Advanced.tsx`、`pages/Diagnostics.tsx`）与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 进程内 librime 引擎（真实候选 + 试打字）接线后复验（2026-11-12）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date` / `Already up to date`，`Done in 677ms`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `62 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 22.67 kB、JS 391.15 kB（gzip 113.10 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict + `noUnusedLocals/Parameters`，无错误 |
| mock 流程冒烟（vite `ssrLoadModule` + `node:assert`） | ✅ | `engine_status` 初始 `linked=true` / `version=1.17.0(mock)` / `initialized=false` / 目录为 null；`preview_typing("nihao")` → preedit `nihao` + 候选 `你好` / `拟好` + `schema=rime_ice` + `accepted_keys=5`，之后 `initialized=true`；`preview_typing("ni")` → `你` / `尼`（comment 空串）；`preview_commit("nihao",0/1)` → `你好` / `拟好`、越界与空候选为 `null`；未收录输入 `zzzz` → preedit 非空 + 候选为空（走「进程内部署」提示分支）；空输入不创建引擎；`deploy_in_process` → `ok=true` + 日志写入 `read_deploy_log`，且引擎被销毁（真实后端行为）；`shutdown_engine` → `initialized=false`、目录清空；`run_diagnostics` / `list_theme_presets` 回归正常 |
| 渲染冒烟（`react-dom/server`） | ✅ | `CandidatePreview`：真实候选时渲染 `你好` / `拟好` + 真实 preedit `nihao` + 状态栏 `方案 · rime_ice`、背景仍取主题 `back`、候选数与序号跟随真实数组；候选为空时保留真实 preedit 并回退静态示例候选；不传 `preview` 时原 `ni` \| `hao` 静态结构不变；`TypingLab` 渲染出「试打字 / preedit / 上屏 / 销毁引擎 / 三个快捷串」；`Appearance` 骨架正常 |

> 本轮只改 `apps/desktop/src/**`（`lib/ipc.ts`、`components/CandidatePreview.tsx`、`components/TypingLab.tsx`、`pages/Appearance.tsx`、`pages/Overview.tsx`）与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

#### 两条流程的交互要点

1. **外观页 · 真实候选预览**：页头显示引擎徽标（`引擎 1.17.0` 绿色 / `未链接 librime` 灰色，来自 `engine_status()`）；候选窗卡片右上角「真实候选」开关默认打开，`linked=false` 时禁用且自动退回静态。开启后候选窗里的候选文字、preedit、状态栏方案名都来自 `preview_typing(<输入框>)`，字号/颜色/圆角/横竖排仍取当前正在编辑的草稿值——改颜色立刻生效，同时候选内容是真实的。输入框默认 `nihao`，防抖 300ms。候选为空 → 黄色提示 + 「进程内部署」（`deploy_in_process()`，成功 toast 并自动重试预览，日志复用页面底部的部署日志卡片并标注 `deploy_in_process()`）；`accepted_keys < 输入长度` → 灰色小字「英文模式下按键由系统直出，引擎不参与」。
2. **概览页 · 试打字**：输入框自动聚焦、防抖 200ms，preedit 显示为高亮输入串，候选按钮带序号 / text / comment；点击任一候选 → `preview_commit(keys, index)` → 右侧「上屏（模拟文本框）」显示 `上屏：xxx`（`aria-live`，换输入串自动清空）；右侧还显示引擎是否已初始化与其 user 目录，以及「销毁引擎」按钮（`shutdown_engine()`，说明「下次预览会自动重建」；刻意不立刻重试预览，否则引擎会马上被重建）；空候选时给「进程内部署」按钮并展示部署日志；`linked=false` 时整块替换为说明卡片（不报错、不留空）。

**为什么试打字放在概览页**：概览是默认落地页（hash 默认 `#/overview`），试打字是「先玩一下」的最低门槛入口，放这里用户不必先学会导航；诊断页已经承载只读的体检、部署日志解析与错误定位，试打字不是诊断动作，塞进去会让「诊断 = 只读判断」这条语义变模糊。

### 写回冲突确认接线后复验（2026-11-12）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date` / `Already up to date`，`Done in 787ms`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `62 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 22.82 kB、JS 391.78 kB（gzip 113.42 kB） |
| `npx tsc --noEmit` | ✅ exit 0 | strict + `noUnusedLocals/Parameters`，无错误 |
| 冲突冒烟（vite `ssrLoadModule` + `react-dom/server`） | ✅ | 解析：`unmanaged` / `drift` 两种中文原文、`Error` 与裸字符串都识别，文件名为 `squirrel.custom.yaml`，多个键按 `、` 切成数组；无 `*.custom.yaml`、有文件名但非冲突、非 Error 输入均返回 `null`。流程：冲突 → 保留我的 → `{status:"kept"}` 且**不抛错**；未带 adopt 的写回仍被拒绝（证明不会静默接管）；冲突 → 覆盖 → 带 `adopt:true` 重放成功并记下被接管的冲突；`drift` 即使 adopt 也再次被拒绝（与真实后端一致）；`__setMockWriteConflict` 一次性开关生效后自动复位；`restore_snapshot` 返回 `refreshed_keys`。渲染：两种 kind 的标题 / 徽标 / 文件 / 键 / 两个按钮均可断言，`open=false` 不渲染任何内容 |

#### 交互要点

- 冲突时**不** toast 报错：`writeGuiConfigWithConflict` 把冲突交给 `ConflictDialog`；选「保留我的（取消写入）」→ 返回 `kept`，页面只 toast「已保留你的修改」；选「用切韵的值覆盖」→ 带 `adopt: true` 重放同一 patch，成功后按普通成功处理。
- 对话框默认焦点在安全选项（保留我的）上，Esc / 点遮罩 / 右上角 × 等价于取消；键名等宽展示，文件名带 `title` 便于长路径悬停查看。

> 本轮只改 `apps/desktop/src/**`（`lib/ipc.ts`、`lib/guiWrite.ts`、`components/ConflictDialog.tsx`、`pages/Dictionaries.tsx`）与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

### 结构化冲突错误 + 三页接线后复验（2026-11-12，后端修复 drift adopt 之后）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pnpm install` | ✅ exit 0 | `Lockfile is up to date`，`Done in 853ms`；pnpm 10 忽略 esbuild build script 的警告依旧存在，不影响构建 |
| `pnpm build`（含 `tsc --noEmit`） | ✅ exit 0 | `65 modules transformed`；产物 `dist/index.html` 0.59 kB、CSS 22.82 kB、JS 399.23 kB（gzip 115.94 kB）——`ConflictDialog` 与接缝现在真的进了包 |
| `npx tsc --noEmit` | ✅ exit 0 | strict + `noUnusedLocals/Parameters`，无错误 |
| 冲突接线冒烟（vite `ssrLoadModule` + `react-dom/server`） | ✅ | `toCommandError` 四种形态（Tauri 对象 / JSON 字符串 / `Error.cause` / `Error.payload`）都能还原，普通 Error / 纯字符串 / undefined 返回 `null`；`parseWriteConflict` 优先结构化 payload（message 不含文件名也认），旧文案回退仍可用，`code ≠ conflict` 返回 `null`；mock 的 `apply_theme` 冲突抛结构化 `CommandError`（含 file/keys）；外观页「冲突 → 保留我的」返回 `kept`、「冲突 → 覆盖 → 成功」（drift 也放行）、无冲突时不弹框；模糊音页「保留 / 覆盖 → 成功」且冲突指向 `<schema>.custom.yaml` 的 `speller/algebra`；方案/按键/双拼共用的 `apply_input_settings`「冲突 → 覆盖 → 成功」；`restore_snapshot` 的 `refreshed_keys` 保持；5 个页面均含 `{conflictDialog}` + `*WithConflict(` + `useConflictPrompt()`，且 SSR 渲染不崩 |

#### 浏览器里怎么点通

1. `pnpm dev` 后在控制台执行 `__qieyunSetMockConflict("drift")`（仅 mock 模式挂载），外观页改一个颜色点「保存」→ 弹出冲突对话框；
2. 选「保留我的（取消写入）」→ 对话框关闭、toast「已保留你的修改」、没有任何第二次请求；
3. 再执行一次 `__qieyunSetMockConflict("drift")` 并点「保存」→ 选「用切韵的值覆盖」→ 写入成功、出现「已保存 · 写入 …」的 toast（drift 由后端在 Adopt 下重登记基线后覆盖）；
4. 模糊音页勾选/取消任一模糊音组后「保存」，同流程：保留 / 覆盖都能走通。

> 本轮只改 `apps/desktop/src/**`（`lib/ipc.ts`、`lib/guiWrite.ts`、`lib/useConflictPrompt.tsx`、`components/ConflictDialog.tsx`、`pages/Appearance.tsx`、`pages/Schemas.tsx`、`pages/KeyBindings.tsx`、`pages/FuzzyPinyin.tsx`、`pages/Shuangpin.tsx`）与本 README，未触碰 `src-tauri/`、`crates/`、`docs/` 与根文件。

## 目录结构

```text
apps/desktop/
├── index.html
├── package.json              # pnpm 脚本与依赖
├── vite.config.ts            # 端口 1420 / strictPort / dist 输出
├── tsconfig.json             # strict + 路径别名 @/*
├── tailwind.config.ts        # 深色 design tokens（base/panel/line/accent…）
├── postcss.config.cjs
├── src/
│   ├── main.tsx              # React 入口
│   ├── App.tsx               # 左侧固定导航 + 右侧内容区 + hash 路由 + 全局部署/快照
│   ├── index.css             # Tailwind 入口、字体栈、滚动条、focus 样式
│   ├── components/           # 手写基础组件
│   │   ├── Badge.tsx  Button.tsx  Card.tsx  Field.tsx
│   │   ├── Icon.tsx          # 内联 SVG 图标（无图标库依赖）
│   │   ├── PageHeader.tsx  PlaceholderNote.tsx  Switch.tsx
│   │   ├── NumberInput.tsx   # 夹取范围的整数输入
│   │   ├── ColorField.tsx    # 颜色槽：color picker + hex + alpha
│   │   ├── CandidatePreview.tsx  # 候选窗实时预览（可接真实引擎候选，空则回退静态示例）
│   │   ├── ConflictDialog.tsx    # 写回冲突确认（未托管键 / 漂移：保留我的 or 覆盖）
│   │   ├── TakeoverBanner.tsx    # 首启接管横幅
│   │   └── TypingLab.tsx         # 试打字面板（真实引擎 preedit/候选/上屏）
│   ├── lib/
│   │   ├── ipc.ts            # 类型化 invoke 封装 + mock 降级
│   │   ├── useIpcQuery.ts    # 极简异步查询 hook
│   │   ├── theme.ts          # hex 校验 / 规范化 / 主题草稿工具
│   │   ├── schema.ts         # 方案详情来源提示 + punctuator 只读格式化
│   │   ├── guiWrite.ts       # 写回冲突确认接缝（识别冲突 → 弹框 → adopt 重放）
│   │   ├── useConflictPrompt.tsx  # 冲突弹框的统一点击通道（每页不各写一份）
│   │   ├── toast.ts          # 全局 toast 事件通道
│   │   ├── format.ts         # 字节数 → 人类可读大小
│   │   ├── demo-data.ts      # 各页面静态展示数据
│   │   └── cn.ts
│   └── pages/                # 10 个页面组件
│       ├── Overview.tsx  Schemas.tsx  Appearance.tsx  KeyBindings.tsx
│       ├── FuzzyPinyin.tsx  Shuangpin.tsx  Punctuation.tsx
│       ├── Dictionaries.tsx  Advanced.tsx  Diagnostics.tsx
└── src-tauri/                # 最小 Tauri 2 工程（本阶段不编译）
    ├── Cargo.toml  build.rs  tauri.conf.json
    ├── capabilities/default.json
    └── src/main.rs  icons/
```

## IPC 契约（`src/lib/ipc.ts`）

命令名、参数与返回值已与 Rust 侧约定一致（snake_case），前端通过 `ipc.*` 调用：

| 命令 | 参数 | 返回 |
| --- | --- | --- |
| `get_env_info` | — | `{ rime_user_dir, shared_dir, platform, rime_version }` |
| `scan_profile` | — | `{ schemas: {id,name,enabled,is_shuangpin}[], themes: string[], default_schema }` |
| `list_snapshots` | — | `{id, created_at, note}[]` |
| `create_snapshot` | `note: string` | `{ id }` |
| `deploy` | — | `{ ok, log }` |
| `read_file` | `path: string` | `{ content }` |
| `write_gui_config` | `patch: { files: Record<string, GuiEdit[]>, note?: string, adopt?: boolean }` | `{ written_files: string[] }`（默认拒绝未托管键 / 漂移；`adopt: true` 才允许覆盖手写键） |
| `get_takeover_plan` | — | `{ taken_over, user_dir, schema_count, custom_files: string[], snapshot_dir }` |
| `accept_takeover` | — | `{ snapshot_id, user_dir }` |
| `list_theme_presets` | — | `{ name, font: {face,point,label_point,line_spacing}, layout: {orientation,corner_radius,border_width,margin,spacing,shadow}, colors: Record<string,string> }[]` |
| `apply_theme` | `{ theme: ThemePreset, adopt?: boolean }` | `{ written_files: string[] }`（错误为结构化 `CommandError`） |
| `get_input_settings` | — | `{ schema_list: string[], page_size, page_keys, toggle_ascii }` |
| `apply_input_settings` | `{ settings: InputSettings, adopt?: boolean }` | `{ written_files: string[] }`（错误为结构化 `CommandError`） |
| `get_schema_detail` | `{ schema_id?: string }`（缺省 = 当前默认方案） | `{ id, name, source: build\|user\|shared\|missing, algebra: string[], punctuator: unknown, switches: {name,states,reset}[], is_shuangpin }` |
| `get_fuzzy_settings` | — | `{ schema_id, schema_name, compiled, rule_count, groups: {id,label,rules,enabled}[] }` |
| `apply_fuzzy_settings` | `{ schema_id, groups: string[], adopt?: boolean }` | `{ written_files: string[] }`（错误为结构化 `CommandError`） |
| `apply_and_deploy` | — | `{ ok, log }` |
| `run_diagnostics` | — | `{ checks: {id,title,status: ok\|warn\|fail,detail,hint: string\|null}[], ok, warn, fail }` |
| `get_dict_inventory` | — | `{ dicts: {name, scope: user\|shared, size_bytes}[], userdbs: {name, size_bytes, legacy_text}[], sync_dir: string\|null, build_artifacts }` |
| `read_deploy_log` | — | `{ exists, content }` |
| `restore_snapshot` | `{ snapshot_id: string }` | `{ restored_files, backup_id: string\|null, refreshed_keys }`（`refreshed_keys` = 恢复后重新登记哈希的托管键数） |
| `reveal_path` | `{ path: string }`（后端校验必须位于用户目录内） | —（成功时无返回） |
| `list_user_files` | — | `{ name, size_bytes, modified: string\|null, kind: custom\|config\|schema\|dict\|installation\|other, editable }[]` |
| `write_raw_file` | `{ name, content }` | `{ snapshot_id: string\|null, bytes }`（写前自动快照；YAML 非法或文件名非法时抛后端原文） |
| `reset_managed_keys` | — | `{ removed }`（只删 `.qieyun/state.json`，不动配置） |
| `clear_deploy_lock` | — | `{ removed }`（只删 `.qieyun/deploy.lock`） |
| `parse_deploy_log` | — | `{ entries: {level: error\|warning\|info, source: string\|null, message, files: string[], hint: string\|null}[], errors, warnings, unparsed: string[] }` |
| `engine_status` | — | `{ linked, version, initialized, user_dir: string\|null, shared_dir: string\|null }`（`linked=false` = stub 构建） |
| `preview_typing` | `{ keys: string }` | `{ preedit, candidates: {text,comment}[], schema: string\|null, accepted_keys, linked }` |
| `preview_commit` | `{ keys: string, index: number }` | `string \| null`（第 index 个候选的上屏文本；越界为 null） |
| `deploy_in_process` | — | `{ ok, log }`（未链接 librime 时后端自动退回子进程部署） |
| `shutdown_engine` | — | `EngineStatus`（销毁后的状态：`initialized=false`、目录清空） |

`get_schema_detail` 的 Rust 签名是 `schema_id: Option<String>`，但命令没有声明 `rename_all = "snake_case"`——Tauri 2 默认按 camelCase 取参数（`schemaId`）。前端 IPC 层在调用时同时携带 `schema_id` 与 `schemaId` 两种拼写，后端将来补上 `rename_all` 也不会坏；`apply_fuzzy_settings` 声明了 `#[tauri::command(rename_all = "snake_case")]`，参数按契约传 snake_case 即可。

`write_raw_file(name, content)` 声明了 `#[tauri::command(rename_all = "snake_case")]`，参数即 `name` / `content`；`list_user_files` / `reset_managed_keys` / `clear_deploy_lock` / `parse_deploy_log` 无参数。

`restore_snapshot` 现在是 `#[tauri::command(rename_all = "snake_case")]`，按 `snapshot_id` 传；前端仍同时携带 `snapshotId`（旧拼写），兼容未重编译的旧后端，多出的键会被忽略。`reveal_path(path)` 是单词参数，无拼写差异。

`preview_typing(keys)` / `preview_commit(keys, index)` 声明了 `rename_all = "snake_case"`，前端按 `{ keys }` / `{ keys, index }` 传参；`engine_status()` / `deploy_in_process()` / `shutdown_engine()` 无参数。`EngineStatus` / `PreviewResult` 的字段本身就是 snake_case，直接按契约读。

**引擎契约里两个必须正确处理的行为**（否则会误报 bug）：

1. `accepted_keys` 可能小于 `keys.length`：`ascii_mode` 开启时 librime 对字母键返回「不消费」，由宿主直接打字。两个页面的 UI 都只做低调提示（灰色小字「英文模式下按键由系统直出，引擎不参与」），不报错。
2. `preview_typing().candidates` 为空但 `preedit` 非空：常见原因是「尚未部署 / 方案未编译」。外观页与试打字面板都会给出提示 + 「进程内部署」按钮（`deploy_in_process()`），成功后 toast 并重试预览，而不是当成失败。

`InputSettings` 的枚举均为 snake_case：`page_keys ∈ comma_period / bracket / page_up_down / off`，`toggle_ascii ∈ control_shift_space / shift_left / off`；`page_size` 范围 3–10。`schema_list` 顺序即生效顺序，第一项为默认方案。

### 写回冲突（未托管键 / 漂移）契约

四个写命令（`write_gui_config` / `apply_theme` / `apply_input_settings` / `apply_fuzzy_settings`）默认**拒绝**覆盖用户手写或手改过的键，错误是**结构化对象**（Tauri 的 `Err` 会序列化成 JSON，不再只是字符串）：

```ts
interface CommandError {
  code: "conflict" | "invalid" | "io" | "engine" | "other";
  message: string;   // 中文原文，可直接展示
  conflict?: { kind: "unmanaged" | "drift"; file: string; keys: string[] };
}
```

- 未托管键：`squirrel.custom.yaml 中的这些键是你手写的、尚未由切韵接管，已中止写入：style/font_point`
- 漂移：`squirrel.custom.yaml 中的这些键被手动修改过，已中止写入：style/font_point`

前端识别与确认链路（页面里只有一份实现）：

| 位置 | 作用 |
| --- | --- |
| `toCommandError(error)` | 把任意 reject 值还原成 `CommandError`：Tauri 抛的对象、`IpcError.cause`、mock 抛的 `CommandError.payload`、被 JSON 序列化成字符串的同一结构都认；普通错误返回 `null`。 |
| `parseWriteConflict(error)` | **优先**读结构化 `payload.conflict`（`code === "conflict"`）；读不到时回退旧后端文案：必须有 `*.custom.yaml` 文件名，含「尚未由切韵接管」→ `unmanaged`，含「被手动修改过」→ `drift`，键名取中文冒号后按 `、` 切分。 |
| `adopt?: boolean` | 四个写命令都支持：`apply_theme` / `apply_input_settings`（`{ theme/settings, adopt }`）、`apply_fuzzy_settings`（`{ schema_id, groups, adopt }`）、`GuiPatch.adopt`。确认接管后为 `true`，后端才会覆盖。 |
| `withConflictConfirmation(run, resolve)` + `applyThemeWithConflict` / `applyInputSettingsWithConflict` / `applyFuzzySettingsWithConflict` / `writeGuiConfigWithConflict`（`src/lib/guiWrite.ts`） | 冲突 → 回调弹 `ConflictDialog` → `keep` 返回 `{status:"kept"}`（不是错误，页面只 toast「已保留你的修改」，**不发第二次请求**）；`adopt` 带 `adopt: true` 重放同一调用。非冲突错误原样抛出。 |
| `useConflictPrompt()`（`src/lib/useConflictPrompt.tsx`） | 返回 `{ resolveConflict, conflictDialog }`：统一弹框、统一「已保留你的修改」toast，页面只负责渲染 `{conflictDialog}` 与按 `kept` 提前返回。 |
| `ConflictDialog` | 两种 `kind` 文案不同（unmanaged =「这些键是你手写的，切韵还没接管」/ drift =「这些键之前由切韵写入，之后被手改」），列出文件名与等宽键名，按钮为「保留我的（取消写入）」+ 危险色「用切韵的值覆盖」；Esc / 点遮罩 / × 等价于取消，默认焦点在安全选项上。 |

写操作接线点（都走上面的接缝，没有第二份实现）：

| 页面 | 命令 | 入口 |
| --- | --- | --- |
| 外观主题 | `apply_theme` | 「保存」「保存并部署」→ `applyThemeWithConflict` |
| 方案与启用 / 按键 / 双拼 | `apply_input_settings` | 「保存」「保存并部署」/ 双拼的启用·设为默认·停用 → `applyInputSettingsWithConflict` |
| 模糊音 | `apply_fuzzy_settings` | 「保存」「保存并部署」→ `applyFuzzySettingsWithConflict` |
| （预留）结构化写回 | `write_gui_config` | `writeGuiConfigWithConflict`，供将来直接用 `GuiPatch` 的页面复用 |

**mock 触发方式**（浏览器里点通两分支）：

1. **一次性开关**：`__setMockWriteConflict("unmanaged" | "drift")`（`src/lib/ipc.ts` 导出，仅 mock 模式生效）让下一次写回无条件冲突并抛结构化 `CommandError`（`file` / `keys` 按命令换成本次目标，例如外观页是 `squirrel.custom.yaml`、模糊音页是 `<schema>.custom.yaml`），触发后自动复位。mock 模式下该函数也挂在 `window.__qieyunSetMockConflict`，可直接在浏览器控制台执行后回页面点「保存」。
2. **哨兵键**（仅 `writeGuiConfig`）：patch 里带 `style/font_point` → unmanaged、`style/font_face` → drift。

`adopt: true` 对 `unmanaged` 与 `drift` 都放行——后端 `write_patch_with` 在 Adopt 下会先把被手改的当前值重新登记为基线再覆盖（`adopt_can_override_drift` 测试守护），所以「用切韵的值覆盖」在两类冲突上都能真正写成功。

降级逻辑：`hasTauriBackend()` 检测 `window.__TAURI_INTERNALS__`（Tauri 2）或 `window.__TAURI__`，缺失时返回 mock 并附带 120ms 延迟，用于真实呈现 loading 态。mock 的接管状态在内存中推进（`accept_takeover` 后 `get_takeover_plan().taken_over` 变为 `true`），方便浏览器里走完整流程。IPC 层会把 Tauri 的 reject 值统一成 `Error.message`：字符串错误直接用原文，结构化 `CommandError` 取 `message`（不再把整个 JSON 糊到用户脸上），原始 payload 留在 `IpcError.cause` 里供 `toCommandError()` 读取。

## 页面与占位设计

导航顺序严格为：概览、方案与启用、外观主题、按键、模糊音、双拼、标点与符号、词典、高级、诊断与日志。

| 页面 | 占位内容的信息结构 |
| --- | --- |
| 概览 | 顶部首启接管横幅（`get_takeover_plan` / `accept_takeover`）+ **试打字面板**（`engine_status` / `preview_typing` / `preview_commit` / `deploy_in_process` / `shutdown_engine`，自动聚焦输入框、preedit 高亮、可点击候选上屏回显、快捷串 `nihao` / `zhongguo` / `women`、销毁引擎）+ 三张状态卡（当前方案 / 目录与运行时 / 体检状态）+ 最近快照列表 + 快捷操作。 |
| 方案与启用 | 已接线：`scan_profile()` 取全部方案 + `get_input_settings()` 取启用顺序；已启用列表按生效顺序展示（第 1 位即默认方案），支持开关启用/停用、设为默认（移到首位）、候选数量 3–10；保存（`apply_input_settings`）后重新扫描同步状态，保存并部署（`apply_and_deploy` + 可折叠日志）。写回撞上未托管键 / 漂移时弹 `ConflictDialog`：选「保留我的」取消本次写入并 toast，选「用切韵的值覆盖」带 `adopt:true` 重放后继续原流程。 |
| 外观主题 | 预设颜色卡 + 候选窗实时预览（顶部 `engine_status()` 引擎徽标；「真实候选」开关默认打开、仅 `linked=true` 时可用——候选文字来自 `preview_typing()`，样式仍取当前编辑中的主题值；可编辑输入串默认 `nihao`、防抖 300ms；候选为空时提示并给「进程内部署」按钮；未链接 librime 时整体退回静态示例候选 + 一句说明）+ 字体/布局/11 个颜色槽编辑 + 保存（`apply_theme`）与保存并部署（`apply_and_deploy` + 可折叠日志）；写回冲突走 `ConflictDialog`（保留我的 / 覆盖后 adopt 重放）+ 进程内部署日志（`deploy_in_process`，复用同一日志卡片并标注来源）。 |
| 按键 | 已接线：翻页键与中英切换两组单选（每个选项展示实际写入的 Rime 绑定）+ 生成的 `key_binder/bindings` YAML 预览（说明用户其它绑定保留）+ 保存 / 保存并部署（`apply_input_settings` / `apply_and_deploy`）；写回冲突同样走 `ConflictDialog` 与 adopt 重放。 |
| 模糊音 | 已接线：`get_fuzzy_settings()` 显示当前默认方案、规则总数与 `compiled` 警告；7 组开关（label + 该组规则原文）+ 实时生成的 `speller/algebra` 片段预览；说明「先剥离旧规则再重建、整段替换、反复保存不膨胀」；保存（`apply_fuzzy_settings`）后重新拉取，保存并部署（`apply_and_deploy` + 可折叠日志）；写回冲突走 `ConflictDialog`（drift 也可 adopt 覆盖）。未选任何组时保存 = 恢复原始 algebra。 |
| 双拼 | 已接线：从 `scan_profile()` 筛 `is_shuangpin` 方案，展示名称/id/启用/是否默认；「启用 / 设为默认 / 停用」每次先 `get_input_settings()` 读最新再 `apply_input_settings()` 写回（默认方案禁止停用，冲突时弹 `ConflictDialog`），可选应用后自动部署；右侧只读 `get_schema_detail()` 的 algebra 原文与 `source` 来源提示。明确标注 V1 不提供键位图（键位与 algebra 强耦合，画错比不画更危险）。 |
| 标点与符号 | 已接线（只读）：`get_schema_detail()`（无参 = 默认方案）的 `punctuator.half_shape` 渲染成「按键 → 输出」两列表格（字符串 / `{commit}` / `{pair}` / 数组统一可读化），`full_shape` 可折叠，`switches` 只读小表格；`punctuator` 缺失或 `source=missing` 时提示继承自 default。V1 不提供编辑。 |
| 词典 | 已接线（只读盘点 + 快照）：`get_dict_inventory()` 的四张统计卡（词典数 / 用户词库数与总大小 / 编译产物数 / 同步目录）；词典表（文件名、user/shared 徽标、人类可读大小）、用户词库表（LevelDB / legacy 文本、大小）与醒目说明「V1 只盘点不修改，删词/导入导出需 V2 的 user_dict API」；同步目录行（未配置时明确提示同步不会生效）；「新建快照」（`create_snapshot`）、快照列表（`list_snapshots`）与二次确认的「恢复」（`restore_snapshot`，toast 为「已恢复 N 个文件（托管键已重新登记 M 个），恢复前已自动备份 <id>」，失败原样展示后端错误）、「在 Finder 中显示」（`reveal_path` + `get_env_info().rime_user_dir`）。无词典时提示「可能是 plum 未安装方案」。 |
| 高级 | 已接线：顶部用户目录（`get_env_info`）+「在 Finder 中显示」（`reveal_path`）；`list_user_files()` 文件表（名称、类型徽标 custom/config/schema/dict/installation/other 分色、`formatBytes` 大小、本地时区修改时间、可编辑列）；点击可编辑文件在右侧编辑器打开（`read_file`），dict 与 `editable=false` 的行只展示元信息并 toast「词典/只读文件不在编辑器内打开（体积与风险）」；等宽 textarea + 行数/字符数/脏标记 + `Cmd/Ctrl+S` 保存（`write_raw_file`，toast 显示字节数与自动备份 id）、保存失败原样展示后端中文错误且保留输入、二次确认的「重新加载」；未保存时切换文件另需确认；危险操作区（红框，各两次确认）：「重置托管键清单」（`reset_managed_keys`，只删 `.qieyun/state.json`，不动配置）与「清理部署锁」（`clear_deploy_lock`，仅在确认无部署进行中时使用，锁下次部署自动重建），文案标明可逆性。页首固定「这里的修改绕过 GUI 校验，保存前会自动快照，但仍建议优先用对应页面。」 |
| 诊断与日志 | 已接线：`run_diagnostics()` 顶部三张统计卡（通过 / 提醒 / 失败，失败用危险色）+ 检查项列表（色条 + 状态图标、detail、`→` 前缀的 hint，fail → warn → ok 排序）；`read_deploy_log()` 的等宽可折叠日志（保留换行、可复制，`exists=false` 显示「还没有部署记录」）；「保存并部署」（`apply_and_deploy` 后刷新日志与体检）、「恢复上一个快照」快捷入口（取 `list_snapshots()` 第一条，二次确认）。新增「部署错误解析」卡片（`parse_deploy_log()`，位于部署日志上方）：`errors>0` 时按 error → warning 列出条目（级别色条 + 徽标、`message`、`source` 如 `deployment_tasks.cc:212`、命中 `files`、`→` 前缀的 `hint`）；`errors===0 && warnings===0` 显示「最近一次部署没有错误/警告」；`unparsed` 非空时折叠展示原始行；「保存并部署」成功/失败后与日志、体检一起刷新解析结果。页头固定一句「这里只报告机器能判断的问题；每条都附下一步动作。」 |

视觉：深色优先、低饱和、信息密度接近专业开发工具；中文优先字体栈（`system-ui / -apple-system / PingFang SC / Microsoft YaHei`）；仅手写 Button/Card/Field/Switch/Badge 等基础组件，未引入 UI 框架。

## 已明确的边界与遗留

- 首启接管、外观主题、方案与启用、按键、模糊音、双拼、标点、词典（只读盘点 + 快照恢复）、高级（原始文件编辑 + 危险操作）、诊断与日志（含部署错误解析）均已接真实 IPC；仅词库导入/导出/删词仍为占位。顶部「新建快照 / 部署」调用真实命令（无 Tauri 时为 mock），并给出 toast 反馈。
- 用户词库是 LevelDB（或 legacy `*.userdb.txt`）格式，V1 只盘点大小与格式，不修改内容；删词/导入导出依赖内嵌 librime 的 `user_dict` API（V2）。`reveal_path` 只调用系统文件管理器，后端会校验路径位于用户目录内。
- `list_snapshots` 的 DTO 只有 `{id, created_at, note}`，`snapshot::SnapshotInfo` 里的 `file_count` 没有透出，因此快照列表暂不展示文件数；如需展示，后端给 `SnapshotDto` 增加一个字段即可（前端契约加 `file_count?: number`）。
- 模糊音写回会整段替换该方案的 `speller/algebra`（后端先剥离旧的模糊音规则再按当前选择重建）；双拼页只改 `schema_list`，不写 algebra；标点页 V1 只读，等后端能按方案安全 patch `punctuator` 的嵌套键后再开放编辑。
- `get_schema_detail` 的参数命名存在前后端拼写差异（Rust 未声明 `rename_all = "snake_case"`，Tauri 2 默认 camelCase），前端同时传两种拼写兜底，建议后端补一行 `rename_all = "snake_case"`。
- 方案与按键页的写回都会经过后端漂移检测：若 `default.custom.yaml` 里托管的键被手动改过，后端返回中文原因并中止写入，页面把原文展示在操作区顶部，不吞错。按键页保存前会重新读取一次最新设置，只替换 `page_keys` / `toggle_ascii`，避免覆写方案页刚保存的 `schema_list` / `page_size`。
- `src-tauri/` 未执行 `cargo build`，图标为脚本生成的占位 PNG（正式发布需 `pnpm tauri icon` 重新生成并补 `.icns` / `.ico`）。
- 路由为轻量 hash 路由（`#/overview` 等），未引入 react-router；后续如需要深链接/嵌套路由再替换。
- 进程内引擎（`engine_status` / `preview_typing` / `preview_commit` / `deploy_in_process` / `shutdown_engine`）已接入：外观页真实候选与概览页试打字都走真实 librime 的临时会话（不污染真实输入法会话）。stub 构建（`linked=false`）下外观页退回静态示例候选 + 一句说明、试打字整块换成说明卡片，不会报错也不留空白。
- 试打字只支持当前默认方案：窄 ABI 没暴露 `select_schema`，后端在方案不匹配时会明确报错而不是静默用错方案（前端把后端原文展示在提示行）。`page_size` 也是方案级配置，预览不传。
- mock 的 `preview_typing` 用一张小词表（`ni` / `nihao` / `zhongguo` / `women`），未收录的输入串**故意返回空候选**，用来在浏览器里点通「可能尚未部署 / 方案未编译」这条分支；mock 的 `linked=true`、`version=1.17.0(mock)`，`deploy_in_process` 会像真实后端一样先销毁引擎再写部署日志，`shutdown_engine` 后 `initialized=false`。
- 写回冲突（未托管键 / 漂移）的确认流程已接入全部写操作：外观页（`apply_theme`）、方案与启用 / 按键 / 双拼（`apply_input_settings`）、模糊音（`apply_fuzzy_settings`）都经 `useConflictPrompt()` + `guiWrite.ts` 的接缝，页面里没有第二份「弹框 + Promise + toast」实现。冲突时**不会**先用 toast 报错；用户选「保留我的」时不再发第二次请求（只 toast），选「覆盖」时带 `adopt: true` 重放同一调用，成功后页面照常刷新 / 部署 / 展示写入文件。
- 结构化错误只覆盖 4 个写命令（`write_gui_config` / `apply_theme` / `apply_input_settings` / `apply_fuzzy_settings`）；其余命令（含 `write_raw_file`、`restore_snapshot`）仍是 `Err(String)`，前端两条路径都兼容（`toCommandError()` 读不到结构时回退文案解析）。
- 只有「本次写入涉及的键」会触发冲突：写文件里不存在的新键不算冲突（后端 `new_keys_are_not_conflicts` 测试）；`schema_list` / `page_size` 这类 GUI 自己刚写过的键走漂移检测。
- 全局快捷键（`Control+Option+\``）仅作展示，未注册系统级快捷键。
- `pnpm install` 时 pnpm 10 默认忽略 esbuild 的 build script（安全默认值）。当前构建正常；如需显式允许，可在 `package.json` 增加 `pnpm.onlyBuiltDependencies: ["esbuild"]` 后重新安装。

## 许可证

GPL-3.0-or-later（与仓库根 Cargo.toml 保持一致）。
