# 切韵 · 桌面前端骨架（M0）

跨平台 Rime 输入法可视化配置工作台的前端外壳。技术栈：**Tauri 2 + React 19 + TypeScript + Vite 6 + Tailwind CSS 3**。

本目录是前端工作区，**前端构建（`pnpm build`）完全不依赖 Rust / Cargo**：`src/lib/ipc.ts` 会检测 Tauri 运行时，缺失时自动降级为 mock 数据。首启接管与外观主题已接入真实 Tauri 命令（`get_takeover_plan` / `accept_takeover` / `list_theme_presets` / `apply_theme` / `apply_and_deploy`），其余页面仍为占位。

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
│   │   ├── CandidatePreview.tsx  # 候选窗实时预览
│   │   └── TakeoverBanner.tsx    # 首启接管横幅
│   ├── lib/
│   │   ├── ipc.ts            # 类型化 invoke 封装 + mock 降级
│   │   ├── useIpcQuery.ts    # 极简异步查询 hook
│   │   ├── theme.ts          # hex 校验 / 规范化 / 主题草稿工具
│   │   ├── toast.ts          # 全局 toast 事件通道
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
| `scan_profile` | — | `{ schemas: {id,name,enabled}[], themes: string[], default_schema }` |
| `list_snapshots` | — | `{id, created_at, note}[]` |
| `create_snapshot` | `note: string` | `{ id }` |
| `deploy` | — | `{ ok, log }` |
| `read_file` | `path: string` | `{ content }` |
| `write_gui_config` | `patch: unknown` | `{ written_files: string[] }` |
| `get_takeover_plan` | — | `{ taken_over, user_dir, schema_count, custom_files: string[], snapshot_dir }` |
| `accept_takeover` | — | `{ snapshot_id, user_dir }` |
| `list_theme_presets` | — | `{ name, font: {face,point,label_point,line_spacing}, layout: {orientation,corner_radius,border_width,margin,spacing,shadow}, colors: Record<string,string> }[]` |
| `apply_theme` | `theme: ThemePreset` | `{ written_files: string[] }` |
| `apply_and_deploy` | — | `{ ok, log }` |

降级逻辑：`hasTauriBackend()` 检测 `window.__TAURI_INTERNALS__`（Tauri 2）或 `window.__TAURI__`，缺失时返回 mock 并附带 120ms 延迟，用于真实呈现 loading 态。mock 的接管状态在内存中推进（`accept_takeover` 后 `get_takeover_plan().taken_over` 变为 `true`），方便浏览器里走完整流程。IPC 层会把 Tauri 的 `Err(String)` 中文原文放进 `Error.message`，页面直接展示（例如「这些键被手动修改过，已中止写入」）。

## 页面与占位设计

导航顺序严格为：概览、方案与启用、外观主题、按键、模糊音、双拼、标点与符号、词典、高级、诊断与日志。

| 页面 | 占位内容的信息结构 |
| --- | --- |
| 概览 | 顶部首启接管横幅（`get_takeover_plan` / `accept_takeover`）+ 三张状态卡（当前方案 / 目录与运行时 / 体检状态）+ 最近快照列表 + 快捷操作。 |
| 方案与启用 | 方案表格（默认方案单选、启用开关、来源）+ 待写入补丁预览 + 方案仓库状态。 |
| 外观主题 | 预设颜色卡 + 候选窗实时预览 + 字体/布局/11 个颜色槽编辑 + 保存（`apply_theme`）与保存并部署（`apply_and_deploy` + 可折叠日志）。 |
| 按键 | 预设选择、动作↔键位映射表、行为开关、自定义按键示例。 |
| 模糊音 | 平翘舌/前后鼻音/n-l 分组开关 + 生成的 `speller/algebra` 补丁预览 + 风险提示。 |
| 双拼 | 方案单选、韵母键位网格、编码示例、自定义映射占位。 |
| 标点与符号 | 半角/全角映射表、预设切换、成对符号/数字全角开关、输入预览。 |
| 词典 | 统计卡、词典清单（大小/词条/启用）、拖拽导入区、同步状态。 |
| 高级 | 配置路径清单、行为开关、原始 YAML 只读预览（`read_file`）、危险操作区。 |
| 诊断与日志 | 体检结果列表、环境信息、检查项范围、带级别的部署日志终端、导出入口。 |

视觉：深色优先、低饱和、信息密度接近专业开发工具；中文优先字体栈（`system-ui / -apple-system / PingFang SC / Microsoft YaHei`）；仅手写 Button/Card/Field/Switch/Badge 等基础组件，未引入 UI 框架。

## 已明确的边界与遗留

- 首启接管与外观主题已接真实 IPC；其余写操作（方案开关、快照恢复、导入等）仍为占位。顶部「新建快照 / 部署」调用真实命令（无 Tauri 时为 mock），并给出 toast 反馈。
- 外观主题的写回会经过后端漂移检测：若 `*.custom.yaml` 里托管的键被手动改过，后端返回中文原因并中止写入，页面把原文展示在操作区顶部，不吞错。
- `src-tauri/` 未执行 `cargo build`，图标为脚本生成的占位 PNG（正式发布需 `pnpm tauri icon` 重新生成并补 `.icns` / `.ico`）。
- 路由为轻量 hash 路由（`#/overview` 等），未引入 react-router；后续如需要深链接/嵌套路由再替换。
- 全局快捷键（`Control+Option+\``）仅作展示，未注册系统级快捷键。
- `pnpm install` 时 pnpm 10 默认忽略 esbuild 的 build script（安全默认值）。当前构建正常；如需显式允许，可在 `package.json` 增加 `pnpm.onlyBuiltDependencies: ["esbuild"]` 后重新安装。

## 许可证

GPL-3.0-or-later（与仓库根 Cargo.toml 保持一致）。
