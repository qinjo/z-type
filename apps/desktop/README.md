# 切韵 · 桌面前端骨架（M0）

跨平台 Rime 输入法可视化配置工作台的前端外壳。技术栈：**Tauri 2 + React 19 + TypeScript + Vite 6 + Tailwind CSS 3**。

本目录是前端工作区，**前端构建（`pnpm build`）完全不依赖 Rust / Cargo**：`src/lib/ipc.ts` 会检测 Tauri 运行时，缺失时自动降级为 mock 数据。首启接管、外观主题、方案与启用、按键、模糊音、双拼、标点、词典、诊断与日志已接入真实 Tauri 命令（`get_takeover_plan` / `accept_takeover` / `list_theme_presets` / `apply_theme` / `scan_profile` / `get_input_settings` / `apply_input_settings` / `apply_and_deploy` / `get_schema_detail` / `get_fuzzy_settings` / `apply_fuzzy_settings` / `run_diagnostics` / `get_dict_inventory` / `read_deploy_log` / `restore_snapshot` / `reveal_path`），仅「高级」页仍为占位。

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
│   │   ├── schema.ts         # 方案详情来源提示 + punctuator 只读格式化
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
| `write_gui_config` | `patch: unknown` | `{ written_files: string[] }` |
| `get_takeover_plan` | — | `{ taken_over, user_dir, schema_count, custom_files: string[], snapshot_dir }` |
| `accept_takeover` | — | `{ snapshot_id, user_dir }` |
| `list_theme_presets` | — | `{ name, font: {face,point,label_point,line_spacing}, layout: {orientation,corner_radius,border_width,margin,spacing,shadow}, colors: Record<string,string> }[]` |
| `apply_theme` | `theme: ThemePreset` | `{ written_files: string[] }` |
| `get_input_settings` | — | `{ schema_list: string[], page_size, page_keys, toggle_ascii }` |
| `apply_input_settings` | `settings: InputSettings` | `{ written_files: string[] }` |
| `get_schema_detail` | `{ schema_id?: string }`（缺省 = 当前默认方案） | `{ id, name, source: build\|user\|shared\|missing, algebra: string[], punctuator: unknown, switches: {name,states,reset}[], is_shuangpin }` |
| `get_fuzzy_settings` | — | `{ schema_id, schema_name, compiled, rule_count, groups: {id,label,rules,enabled}[] }` |
| `apply_fuzzy_settings` | `{ schema_id, groups: string[] }` | `{ written_files: string[] }` |
| `apply_and_deploy` | — | `{ ok, log }` |
| `run_diagnostics` | — | `{ checks: {id,title,status: ok\|warn\|fail,detail,hint: string\|null}[], ok, warn, fail }` |
| `get_dict_inventory` | — | `{ dicts: {name, scope: user\|shared, size_bytes}[], userdbs: {name, size_bytes, legacy_text}[], sync_dir: string\|null, build_artifacts }` |
| `read_deploy_log` | — | `{ exists, content }` |
| `restore_snapshot` | `{ snapshot_id: string }` | `{ restored_files, backup_id: string\|null }` |
| `reveal_path` | `{ path: string }`（后端校验必须位于用户目录内） | —（成功时无返回） |

`get_schema_detail` 的 Rust 签名是 `schema_id: Option<String>`，但命令没有声明 `rename_all = "snake_case"`——Tauri 2 默认按 camelCase 取参数（`schemaId`）。前端 IPC 层在调用时同时携带 `schema_id` 与 `schemaId` 两种拼写，后端将来补上 `rename_all` 也不会坏；`apply_fuzzy_settings` 声明了 `#[tauri::command(rename_all = "snake_case")]`，参数按契约传 snake_case 即可。

`restore_snapshot(snapshot_id: String)` 同样没有声明 `rename_all = "snake_case"`，前端按同一策略同时携带 `snapshot_id` 与 `snapshotId`。`reveal_path(path)` 是单词参数，无拼写差异。

`InputSettings` 的枚举均为 snake_case：`page_keys ∈ comma_period / bracket / page_up_down / off`，`toggle_ascii ∈ control_shift_space / shift_left / off`；`page_size` 范围 3–10。`schema_list` 顺序即生效顺序，第一项为默认方案。

降级逻辑：`hasTauriBackend()` 检测 `window.__TAURI_INTERNALS__`（Tauri 2）或 `window.__TAURI__`，缺失时返回 mock 并附带 120ms 延迟，用于真实呈现 loading 态。mock 的接管状态在内存中推进（`accept_takeover` 后 `get_takeover_plan().taken_over` 变为 `true`），方便浏览器里走完整流程。IPC 层会把 Tauri 的 `Err(String)` 中文原文放进 `Error.message`，页面直接展示（例如「这些键被手动修改过，已中止写入」）。

## 页面与占位设计

导航顺序严格为：概览、方案与启用、外观主题、按键、模糊音、双拼、标点与符号、词典、高级、诊断与日志。

| 页面 | 占位内容的信息结构 |
| --- | --- |
| 概览 | 顶部首启接管横幅（`get_takeover_plan` / `accept_takeover`）+ 三张状态卡（当前方案 / 目录与运行时 / 体检状态）+ 最近快照列表 + 快捷操作。 |
| 方案与启用 | 已接线：`scan_profile()` 取全部方案 + `get_input_settings()` 取启用顺序；已启用列表按生效顺序展示（第 1 位即默认方案），支持开关启用/停用、设为默认（移到首位）、候选数量 3–10；保存（`apply_input_settings`）后重新扫描同步状态，保存并部署（`apply_and_deploy` + 可折叠日志）。 |
| 外观主题 | 预设颜色卡 + 候选窗实时预览 + 字体/布局/11 个颜色槽编辑 + 保存（`apply_theme`）与保存并部署（`apply_and_deploy` + 可折叠日志）。 |
| 按键 | 已接线：翻页键与中英切换两组单选（每个选项展示实际写入的 Rime 绑定）+ 生成的 `key_binder/bindings` YAML 预览（说明用户其它绑定保留）+ 保存 / 保存并部署（`apply_input_settings` / `apply_and_deploy`）。 |
| 模糊音 | 已接线：`get_fuzzy_settings()` 显示当前默认方案、规则总数与 `compiled` 警告；7 组开关（label + 该组规则原文）+ 实时生成的 `speller/algebra` 片段预览；说明「先剥离旧规则再重建、整段替换、反复保存不膨胀」；保存（`apply_fuzzy_settings`）后重新拉取，保存并部署（`apply_and_deploy` + 可折叠日志）。未选任何组时保存 = 恢复原始 algebra。 |
| 双拼 | 已接线：从 `scan_profile()` 筛 `is_shuangpin` 方案，展示名称/id/启用/是否默认；「启用 / 设为默认 / 停用」每次先 `get_input_settings()` 读最新再 `apply_input_settings()` 写回（默认方案禁止停用），可选应用后自动部署；右侧只读 `get_schema_detail()` 的 algebra 原文与 `source` 来源提示。明确标注 V1 不提供键位图（键位与 algebra 强耦合，画错比不画更危险）。 |
| 标点与符号 | 已接线（只读）：`get_schema_detail()`（无参 = 默认方案）的 `punctuator.half_shape` 渲染成「按键 → 输出」两列表格（字符串 / `{commit}` / `{pair}` / 数组统一可读化），`full_shape` 可折叠，`switches` 只读小表格；`punctuator` 缺失或 `source=missing` 时提示继承自 default。V1 不提供编辑。 |
| 词典 | 已接线（只读盘点 + 快照）：`get_dict_inventory()` 的四张统计卡（词典数 / 用户词库数与总大小 / 编译产物数 / 同步目录）；词典表（文件名、user/shared 徽标、人类可读大小）、用户词库表（LevelDB / legacy 文本、大小）与醒目说明「V1 只盘点不修改，删词/导入导出需 V2 的 user_dict API」；同步目录行（未配置时明确提示同步不会生效）；「新建快照」（`create_snapshot`）、快照列表（`list_snapshots`）与二次确认的「恢复」（`restore_snapshot`，toast 显示恢复文件数与自动备份 id）、「在 Finder 中显示」（`reveal_path` + `get_env_info().rime_user_dir`）。无词典时提示「可能是 plum 未安装方案」。 |
| 高级 | 配置路径清单、行为开关、原始 YAML 只读预览（`read_file`）、危险操作区。 |
| 诊断与日志 | 已接线：`run_diagnostics()` 顶部三张统计卡（通过 / 提醒 / 失败，失败用危险色）+ 检查项列表（色条 + 状态图标、detail、`→` 前缀的 hint，fail → warn → ok 排序）；`read_deploy_log()` 的等宽可折叠日志（保留换行、可复制，`exists=false` 显示「还没有部署记录」）；「保存并部署」（`apply_and_deploy` 后刷新日志与体检）、「恢复上一个快照」快捷入口（取 `list_snapshots()` 第一条，二次确认）。页头固定一句「这里只报告机器能判断的问题；每条都附下一步动作。」 |

视觉：深色优先、低饱和、信息密度接近专业开发工具；中文优先字体栈（`system-ui / -apple-system / PingFang SC / Microsoft YaHei`）；仅手写 Button/Card/Field/Switch/Badge 等基础组件，未引入 UI 框架。

## 已明确的边界与遗留

- 首启接管、外观主题、方案与启用、按键、模糊音、双拼、标点、词典（只读盘点 + 快照恢复）、诊断与日志已接真实 IPC；仅「高级」页与词库导入/导出/删词仍为占位。顶部「新建快照 / 部署」调用真实命令（无 Tauri 时为 mock），并给出 toast 反馈。
- 用户词库是 LevelDB（或 legacy `*.userdb.txt`）格式，V1 只盘点大小与格式，不修改内容；删词/导入导出依赖内嵌 librime 的 `user_dict` API（V2）。`reveal_path` 只调用系统文件管理器，后端会校验路径位于用户目录内。
- `list_snapshots` 的 DTO 只有 `{id, created_at, note}`，`snapshot::SnapshotInfo` 里的 `file_count` 没有透出，因此快照列表暂不展示文件数；如需展示，后端给 `SnapshotDto` 增加一个字段即可（前端契约加 `file_count?: number`）。
- 模糊音写回会整段替换该方案的 `speller/algebra`（后端先剥离旧的模糊音规则再按当前选择重建）；双拼页只改 `schema_list`，不写 algebra；标点页 V1 只读，等后端能按方案安全 patch `punctuator` 的嵌套键后再开放编辑。
- `get_schema_detail` 的参数命名存在前后端拼写差异（Rust 未声明 `rename_all = "snake_case"`，Tauri 2 默认 camelCase），前端同时传两种拼写兜底，建议后端补一行 `rename_all = "snake_case"`。
- 方案与按键页的写回都会经过后端漂移检测：若 `default.custom.yaml` 里托管的键被手动改过，后端返回中文原因并中止写入，页面把原文展示在操作区顶部，不吞错。按键页保存前会重新读取一次最新设置，只替换 `page_keys` / `toggle_ascii`，避免覆写方案页刚保存的 `schema_list` / `page_size`。
- `src-tauri/` 未执行 `cargo build`，图标为脚本生成的占位 PNG（正式发布需 `pnpm tauri icon` 重新生成并补 `.icns` / `.ico`）。
- 路由为轻量 hash 路由（`#/overview` 等），未引入 react-router；后续如需要深链接/嵌套路由再替换。
- 全局快捷键（`Control+Option+\``）仅作展示，未注册系统级快捷键。
- `pnpm install` 时 pnpm 10 默认忽略 esbuild 的 build script（安全默认值）。当前构建正常；如需显式允许，可在 `package.json` 增加 `pnpm.onlyBuiltDependencies: ["esbuild"]` 后重新安装。

## 许可证

GPL-3.0-or-later（与仓库根 Cargo.toml 保持一致）。
