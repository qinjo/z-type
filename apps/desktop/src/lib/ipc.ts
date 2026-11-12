/**
 * IPC 契约层：前端与 Tauri (Rust) 后端之间唯一的通信入口。
 *
 * Rust 侧命令尚未实现，因此这里做两件事：
 * 1. 用 TypeScript 固化命令名、参数与返回值的契约；
 * 2. 检测不到 Tauri 运行时（例如浏览器里 `pnpm dev` 或纯前端 `pnpm build`）时，
 *    自动降级为 mock 数据，保证 UI 可以在没有 Rust 后端的情况下独立开发与构建。
 */

import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// 契约类型（与 Rust 侧 serde 结构一一对应，命名保持 snake_case）
// ---------------------------------------------------------------------------

export interface EnvInfo {
  rime_user_dir: string;
  shared_dir: string;
  platform: string;
  rime_version: string;
}

export interface SchemaInfo {
  id: string;
  name: string;
  enabled: boolean;
  /** 后端按「id 以 double_pinyin 开头 / 名称含『双拼』」判定的双拼方案。 */
  is_shuangpin: boolean;
}

export interface Profile {
  schemas: SchemaInfo[];
  themes: string[];
  default_schema: string;
}

/** 方案详情的来源。`build` 是已部署的 librime 编译产物，最可靠。 */
export type SchemaSource = "build" | "user" | "shared" | "missing";

/** `switches` 项：开关名、状态文案与默认复位值（`reset` 可能缺省）。 */
export interface SchemaSwitch {
  name: string;
  states: string[];
  reset: number | null;
}

/** `get_schema_detail()`：只读的方案详情。 */
export interface SchemaDetail {
  id: string;
  name: string;
  source: SchemaSource;
  /** `speller/algebra` 规则原文（只保留字符串项）。 */
  algebra: string[];
  /** 原始 `punctuator` 结构，可能是 object 或 null，交给页面做只读渲染。 */
  punctuator: unknown;
  switches: SchemaSwitch[];
  is_shuangpin: boolean;
}

/** 模糊音分组（`groups[].id` 固定为 zh-z / ch-c / sh-s / n-l / f-h / nasal / r-l）。 */
export interface FuzzyGroup {
  id: string;
  label: string;
  rules: string[];
  enabled: boolean;
}

/** `get_fuzzy_settings()`：当前默认方案的模糊音状态。 */
export interface FuzzySettings {
  schema_id: string;
  schema_name: string;
  /** false 表示读不到 build 产物，规则可能不含 __include 展开。 */
  compiled: boolean;
  rule_count: number;
  groups: FuzzyGroup[];
}

export interface Snapshot {
  id: string;
  created_at: string;
  note: string;
  /** 快照包含的配置文件数（后端 list_snapshots 提供）。 */
  file_count?: number;
}

export interface DeployResult {
  ok: boolean;
  log: string;
}

/** 体检单条结果的状态：正常 / 提醒 / 失败（Rust `CheckStatus`，小写序列化）。 */
export type CheckStatus = "ok" | "warn" | "fail";

/** `run_diagnostics()` 的单项：`hint` 是可执行的下一条动作，可能缺省。 */
export interface DiagnosticsCheck {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  hint: string | null;
}

export interface DiagnosticsReport {
  checks: DiagnosticsCheck[];
  ok: number;
  warn: number;
  fail: number;
}

/** 词典文件来源：用户目录 / 共享目录（Rust `DictScope`）。 */
export type DictScope = "user" | "shared";

export interface DictFile {
  name: string;
  scope: DictScope;
  size_bytes: number;
}

/** 用户词库：LevelDB 是目录，legacy 的是 `*.userdb.txt` 文本。 */
export interface UserDb {
  name: string;
  size_bytes: number;
  legacy_text: boolean;
}

export interface DictInventory {
  dicts: DictFile[];
  userdbs: UserDb[];
  sync_dir: string | null;
  /** `build/` 里的编译产物数量（`.bin` + `.schema.yaml`）。 */
  build_artifacts: number;
}

/** `read_deploy_log()`：最近一次部署日志；不存在时 `exists=false`、`content` 为空串。 */
export interface DeployLog {
  exists: boolean;
  content: string;
}

/** `restore_snapshot()`：恢复前后端会先自动备份当前状态。 */
export interface RestoreResult {
  restored_files: number;
  backup_id: string | null;
}

/** 用户目录里的文件类别（Rust `FileKind`，snake_case 序列化）。 */
export type UserFileKind =
  | "custom"
  | "config"
  | "schema"
  | "dict"
  | "installation"
  | "other";

/** `list_user_files()` 的单行：`.yaml` / `.yml` / `.txt` 文件。 */
export interface UserFile {
  name: string;
  size_bytes: number;
  /** ISO8601 UTC；读不到 mtime 时为 null。 */
  modified: string | null;
  kind: UserFileKind;
  /** dict 与只读文件为 false，高级页不会把它们塞进编辑器。 */
  editable: boolean;
}

/** `write_raw_file()`：写入前自动快照，返回快照 id（用户目录不存在时为 null）与字节数。 */
export interface RawWriteResult {
  snapshot_id: string | null;
  bytes: number;
}

/** 危险操作（`reset_managed_keys` / `clear_deploy_lock`）的统一返回。 */
export interface DangerResult {
  removed: boolean;
}

/** 部署日志级别（Rust `LogLevel`，小写序列化）。 */
export type DeployLogLevel = "error" | "warning" | "info";

/** `parse_deploy_log()` 的单项：源位置、涉及文件与下一步动作都可能缺省。 */
export interface DeployLogEntry {
  level: DeployLogLevel;
  /** 例如 `deployment_tasks.cc:212`。 */
  source: string | null;
  message: string;
  /** 消息里提到的文件名（.yaml / .bin 等）。 */
  files: string[];
  hint: string | null;
}

/** `parse_deploy_log()`：最近一次部署日志的解析结果；`unparsed` 保留无法识别的行。 */
export interface ParsedDeployLog {
  entries: DeployLogEntry[];
  errors: number;
  warnings: number;
  unparsed: string[];
}

export interface FileContent {
  content: string;
}

export interface WriteResult {
  written_files: string[];
}

/** 翻页键风格（Rust `PageKeys`，snake_case 序列化）。 */
export type PageKeys = "comma_period" | "bracket" | "page_up_down" | "off";

/** 中英切换热键（Rust `AsciiToggleKey`，snake_case 序列化）。 */
export type AsciiToggleKey = "control_shift_space" | "shift_left" | "off";

/**
 * `default.custom.yaml` 里 GUI 托管的输入设置。
 * `schema_list` 的顺序即生效顺序，第一个是默认方案。
 */
export interface InputSettings {
  schema_list: string[];
  /** 候选数量，3–10。 */
  page_size: number;
  page_keys: PageKeys;
  toggle_ascii: AsciiToggleKey;
}

/** 首启接管计划：接管只备份 + 登记托管键，不做任何配置写入。 */
export interface TakeoverPlan {
  taken_over: boolean;
  user_dir: string;
  schema_count: number;
  custom_files: string[];
  snapshot_dir: string;
}

export interface TakeoverResult {
  snapshot_id: string;
  user_dir: string;
}

export interface FontDto {
  face: string;
  point: number;
  label_point: number;
  line_spacing: number;
}

export type Orientation = "horizontal" | "vertical";

export interface LayoutDto {
  orientation: Orientation;
  corner_radius: number;
  border_width: number;
  margin: number;
  spacing: number;
  shadow: number;
}

/**
 * 主题颜色槽（顺序与 Rust `Colors::entries` 一致）。
 * 契约里 `colors` 是 `Record<string, string>`，页面应只遍历这个白名单。
 */
export const THEME_COLOR_SLOTS = [
  "back",
  "border",
  "text",
  "candidate_text",
  "comment_text",
  "hilited_back",
  "hilited_text",
  "hilited_candidate_back",
  "hilited_candidate_text",
  "hilited_candidate_border",
  "hilited_border",
] as const;

export type ThemeColorSlot = (typeof THEME_COLOR_SLOTS)[number];

export interface ThemePreset {
  name: string;
  font: FontDto;
  layout: LayoutDto;
  /** 槽位名 -> `#RRGGBB` 或 `#RRGGBBAA`。 */
  colors: Record<string, string>;
}

/**
 * `write_gui_config` 的载荷：文件名 → 该文件的编辑序列。
 * 对应 Rust 侧 `commands::GuiPatch`（`op` 用 tag 区分，serde 反序列化）。
 */
export type GuiEdit =
  | { op: "set"; key: string; value: unknown }
  | { op: "setraw"; key: string; raw: string }
  | { op: "remove"; key: string };

export interface GuiPatch {
  files: Record<string, GuiEdit[]>;
  note?: string;
}

/** 命令名 -> { 参数, 返回值 } 的静态映射，供实现方与调用方共同引用。 */
export interface IpcContract {
  get_env_info: { args: undefined; result: EnvInfo };
  scan_profile: { args: undefined; result: Profile };
  list_snapshots: { args: undefined; result: Snapshot[] };
  create_snapshot: { args: { note: string }; result: { id: string } };
  deploy: { args: undefined; result: DeployResult };
  read_file: { args: { path: string }; result: FileContent };
  write_gui_config: { args: { patch: GuiPatch }; result: WriteResult };
  get_takeover_plan: { args: undefined; result: TakeoverPlan };
  accept_takeover: { args: undefined; result: TakeoverResult };
  list_theme_presets: { args: undefined; result: ThemePreset[] };
  apply_theme: { args: { theme: ThemePreset }; result: WriteResult };
  get_input_settings: { args: undefined; result: InputSettings };
  apply_input_settings: { args: { settings: InputSettings }; result: WriteResult };
  get_schema_detail: { args: { schema_id?: string }; result: SchemaDetail };
  get_fuzzy_settings: { args: undefined; result: FuzzySettings };
  apply_fuzzy_settings: { args: { schema_id: string; groups: string[] }; result: WriteResult };
  apply_and_deploy: { args: undefined; result: DeployResult };
  run_diagnostics: { args: undefined; result: DiagnosticsReport };
  get_dict_inventory: { args: undefined; result: DictInventory };
  read_deploy_log: { args: undefined; result: DeployLog };
  restore_snapshot: { args: { snapshot_id: string }; result: RestoreResult };
  reveal_path: { args: { path: string }; result: void };
  list_user_files: { args: undefined; result: UserFile[] };
  write_raw_file: { args: { name: string; content: string }; result: RawWriteResult };
  reset_managed_keys: { args: undefined; result: DangerResult };
  clear_deploy_lock: { args: undefined; result: DangerResult };
  parse_deploy_log: { args: undefined; result: ParsedDeployLog };
}

export type IpcCommand = keyof IpcContract;

// ---------------------------------------------------------------------------
// 运行时检测
// ---------------------------------------------------------------------------

/** Tauri 2 注入 `__TAURI_INTERNALS__`，旧的 `__TAURI__`（withGlobalTauri）也一并兼容。 */
export function hasTauriBackend(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || "__TAURI__" in w;
}

/** 当前是否运行在 mock 降级模式（后端未接入）。 */
export const usingMockBackend = !hasTauriBackend();

// ---------------------------------------------------------------------------
// mock 数据（同时作为 UI 联调时的默认样例）
// ---------------------------------------------------------------------------

const MOCK_ENV: EnvInfo = {
  rime_user_dir: "~/Library/Rime",
  shared_dir: "/Library/Input Methods/Squirrel.app/Contents/Resources",
  platform: "macOS 15.4.1 (arm64)",
  rime_version: "1.11.2",
};

const MOCK_PROFILE: Profile = {
  schemas: [
    { id: "rime_ice", name: "雾凇拼音", enabled: true, is_shuangpin: false },
    { id: "double_pinyin_flypy", name: "小鹤双拼", enabled: true, is_shuangpin: true },
    { id: "luna_pinyin", name: "朙月拼音", enabled: true, is_shuangpin: false },
    { id: "double_pinyin_abc", name: "智能 ABC 双拼", enabled: false, is_shuangpin: true },
    { id: "wubi86", name: "五笔 86", enabled: false, is_shuangpin: false },
    { id: "cangjie5", name: "仓颉五代", enabled: false, is_shuangpin: false },
  ],
  themes: ["碧落", "明月", "青瓷", "素笺"],
  default_schema: "rime_ice",
};

/** mock 快照列表会在内存中推进（新建 / 恢复前自动备份），让页面流程完整可走。 */
let mockSnapshots: Snapshot[] = [
  { id: "20261111-1928", created_at: "2026-11-11 19:28", note: "初始化工作台" },
  { id: "20261110-2142", created_at: "2026-11-10 21:42", note: "切换默认方案为雾凇拼音" },
  { id: "20261109-1035", created_at: "2026-11-09 10:35", note: "调整候选窗字号" },
];

function mockStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function mockSnapshotId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** mock 的 id 精确到秒：同一秒内连续操作时补后缀，避免 React list key 冲突。 */
function mockUniqueSnapshotId(): string {
  const base = mockSnapshotId();
  let id = base;
  let suffix = 2;
  while (mockSnapshots.some((item) => item.id === id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

// ---------------------------------------------------------------------------
// 诊断 / 词典 / 部署日志 mock
// ---------------------------------------------------------------------------

/**
 * 体检的初始 mock：3 通过 / 1 提醒 / 1 失败。
 * 「构建产物是否最新」在 mock 部署一次后转为通过，用来验证页面刷新会跟着 build 状态变化。
 */
function mockDiagnostics(): DiagnosticsReport {
  const checks: DiagnosticsCheck[] = [
    {
      id: "user-dir",
      title: "Rime 用户目录",
      status: "ok",
      detail: "~/Library/Rime · 12 个配置文件",
      hint: null,
    },
    {
      id: "shared-dir",
      title: "共享目录",
      status: "ok",
      detail: "/Library/Input Methods/Squirrel.app/Contents/Resources",
      hint: null,
    },
    {
      id: "default-schema",
      title: "默认方案可加载",
      status: "ok",
      detail: "rime_ice · 雾凇拼音",
      hint: null,
    },
    mockDeployed
      ? {
          id: "build-fresh",
          title: "构建产物是否最新",
          status: "ok",
          detail: "build/ 已跟随最近的 custom.yaml 重建",
          hint: null,
        }
      : {
          id: "build-stale",
          title: "构建产物是否最新",
          status: "warn",
          detail: "build/ 落后于 3 个 custom.yaml",
          hint: "点「保存并部署」重建一次；若仍提示，检查这些 yaml 是否有语法错误。",
        },
    {
      id: "plugin",
      title: "插件目录",
      status: "fail",
      detail: "未发现 librime-lua 插件",
      hint: "需要 lua 插件时，把 librime-lua.dylib 放进用户目录的 plugins/ 后重启输入法。",
    },
  ];
  return {
    checks,
    ok: checks.filter((check) => check.status === "ok").length,
    warn: checks.filter((check) => check.status === "warn").length,
    fail: checks.filter((check) => check.status === "fail").length,
  };
}

const MOCK_DICT_INVENTORY: DictInventory = {
  dicts: [
    { name: "rime_ice.dict.yaml", scope: "user", size_bytes: 1_258_291 },
    { name: "luna_pinyin.dict.yaml", scope: "shared", size_bytes: 3_942_400 },
  ],
  userdbs: [{ name: "rime_ice.userdb", size_bytes: 2_411_724, legacy_text: false }],
  sync_dir: "~/Library/Mobile Documents/com~apple~CloudDocs/Rime",
  build_artifacts: 12,
};

const MOCK_DEPLOY_LOG_LINES = [
  "[19:28:01] 读取用户目录 ~/Library/Rime",
  "[19:28:01] 校验 default.custom.yaml",
  "[19:28:02] 编译 rime_ice.schema.yaml -> build/rime_ice.schema.yaml",
  "[19:28:02] 写入 build/rime_ice.prism.bin",
  "[19:28:03] 警告：luna_pinyin.dict.yaml 未被任何方案引用",
  "[19:28:03] 部署完成，耗时 1.24s",
];

let mockDeployLog: DeployLog = {
  exists: true,
  content: MOCK_DEPLOY_LOG_LINES.join("\n"),
};

/** mock 是否已经部署过：决定「构建产物是否最新」这条检查的状态。 */
let mockDeployed = false;

/** 模拟一次部署：刷新日志并让 build 检查转为通过。 */
function mockRecordDeploy(log: string): DeployLog {
  mockDeployed = true;
  mockDeployLog = {
    exists: true,
    content: log.trim() ? log : MOCK_DEPLOY_LOG_LINES.join("\n"),
  };
  return mockDeployLog;
}

// ---------------------------------------------------------------------------
// 高级页（原始文件 / 危险操作）与部署日志解析 mock
// ---------------------------------------------------------------------------

/** mock 用户目录的内容：文件清单、大小与 read_file 都从这里派生。 */
interface MockUserFile {
  kind: UserFileKind;
  editable: boolean;
  /** ISO8601 UTC。 */
  modified: string;
  content: string;
}

/**
 * 高级页的文件清单 mock。
 * `installation.yaml` 与 `rime_ice.dict.yaml` 按后端规则为只读（`editable=false`），
 * 用来验证「词典/只读文件不在编辑器内打开」的分支。
 */
const mockUserFiles: Record<string, MockUserFile> = {
  "default.custom.yaml": {
    kind: "custom",
    editable: true,
    modified: "2026-11-11T11:28:00Z",
    content: [
      "patch:",
      "  schema_list:",
      "    - schema: rime_ice",
      "    - schema: double_pinyin_flypy",
      "  menu:",
      "    page_size: 7",
      "",
    ].join("\n"),
  },
  "default.yaml": {
    kind: "config",
    editable: true,
    modified: "2026-11-09T02:35:00Z",
    content: ["config_version: 0.1", "schema_list:", "  - schema: luna_pinyin", ""].join(
      "\n",
    ),
  },
  "rime_ice.schema.yaml": {
    kind: "schema",
    editable: true,
    modified: "2026-11-10T13:42:00Z",
    content: [
      "schema:",
      "  schema_id: rime_ice",
      "  name: 雾凇拼音",
      "  version: 2026.11.10",
      "switches:",
      "  - name: ascii_mode",
      "    reset: 0",
      "",
    ].join("\n"),
  },
  "rime_ice.dict.yaml": {
    kind: "dict",
    editable: false,
    modified: "2026-11-08T07:08:00Z",
    // 字典通常几十 MB，这里只放一小段占位；编辑器不会打开它。
    content: [
      "# Rime dictionary",
      "name: rime_ice",
      "version: \"2026.11.08\"",
      "sort: by_weight",
      "columns:",
      "  - text",
      "  - code",
      "  - weight",
      "---",
      "的\tn\t100",
      "",
    ].join("\n"),
  },
  "installation.yaml": {
    kind: "installation",
    editable: false,
    modified: "2026-11-06T01:12:00Z",
    content: ["distribution_code_name: Squirrel", "installation_id: qieyun-mock", ""].join(
      "\n",
    ),
  },
};

function mockByteLength(text: string): number {
  // TextEncoder 在浏览器与 Node 20 的全局作用域里都有；兜底按 UTF-16 长度估算。
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).length;
  return text.length;
}

function mockUserFileList(): UserFile[] {
  return Object.entries(mockUserFiles)
    .map(([name, file]) => ({
      name,
      size_bytes: mockByteLength(file.content),
      modified: file.modified,
      kind: file.kind,
      editable: file.editable,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * mock 的写回前校验：文件名规则与 Rust `raw_editable_file` 保持一致。
 * 错误文案照抄后端 `WriteError::InvalidFile` 的中文原文，页面按原样展示。
 */
function mockRawEditableName(name: string): string | null {
  const lower = name.toLowerCase();
  const bad =
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("..") ||
    lower.endsWith(".dict.yaml") ||
    !(lower.endsWith(".yaml") || lower.endsWith(".yml") || lower.endsWith(".txt"));
  if (bad) {
    return `拒绝写入非 custom 文件或非法文件名：${name}`;
  }
  const known = mockUserFiles[name];
  if (known && !known.editable) {
    // 后端对这类文件同样走 InvalidFile；这里保留同一句文案，避免 mock 与真机行为分叉。
    return `拒绝写入非 custom 文件或非法文件名：${name}`;
  }
  return null;
}

/**
 * mock 的 YAML 语法检查（刻意粗糙）：只覆盖最高频的手滑场景——
 * 缩进里出现 Tab、行尾悬空的键、括号/引号不配对。
 * 真实后端用 serde_yaml，报错文案以它为准，这里只用于验证「原样展示错误」。
 */
function mockYamlError(content: string): string | null {
  if (!content.trim()) return null;
  const lines = content.split("\n");
  let brackets = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*\t/.test(line)) {
      return `第 ${index + 1} 行：缩进里出现 Tab，YAML 只允许空格缩进。`;
    }
    const text = line.replace(/#.*$/, "");
    brackets += (text.match(/[[{]/g) ?? []).length;
    brackets -= (text.match(/[\]}]/g) ?? []).length;
    if (brackets < 0) {
      return `第 ${index + 1} 行：括号不配对（多了一个 ] 或 }）。`;
    }
    if (/^\s*[^\s#][^:]*:\s*$/.test(text) && index + 1 < lines.length) {
      const next = lines[index + 1] ?? "";
      if (next.trim() && !/^\s*$/.test(next) && !/^(\s+|#|-)/.test(next)) {
        return `第 ${index + 1} 行：键后面的值只能换行缩进或同一行给出。`;
      }
    }
  }
  if (brackets !== 0) return "括号不配对（[ ] / { } 没有闭合）。";
  return null;
}

const mockDeployLogEntries: DeployLogEntry[] = [
  {
    level: "error",
    source: "deployment_tasks.cc:212",
    message: "missing input schema: ghost",
    files: ["default.custom.yaml"],
    hint: "方案 ghost 未安装或 id 拼错：在「方案与启用」里停用它，或安装对应方案后重新部署。",
  },
  {
    level: "warning",
    source: "deployment_tasks.cc:98",
    message: "unrecognized key: menu/page_sizes",
    files: ["default.custom.yaml"],
    hint: "检查 YAML 缩进与键名拼写（page_size，不是 page_sizes）；改完再部署一次。",
  },
];

const mockUnparsedLines = ["some stray output", "loading `rime_ice` ..."];

/** 危险操作 mock 的前置状态：首次点击返回 `removed=true`，再点一次为 `false`。 */
let mockManagedKeysPresent = true;
let mockDeployLockPresent = true;

/** 部署解析 mock：首次部署前有 1 错误 / 1 警告；部署一次后变成干净结果。 */
function mockParseDeployLog(): ParsedDeployLog {
  if (!mockDeployed) {
    return {
      entries: mockDeployLogEntries.map((entry) => ({
        ...entry,
        files: [...entry.files],
      })),
      errors: 1,
      warnings: 1,
      unparsed: [...mockUnparsedLines],
    };
  }
  return {
    entries: [
      {
        level: "info",
        source: null,
        message: "deployment succeeded, 耗时 1.24s",
        files: [],
        hint: null,
      },
    ],
    errors: 0,
    warnings: 0,
    unparsed: [...mockUnparsedLines],
  };
}

const MOCK_FILE_CONTENT: FileContent = {
  content: [
    "patch:",
    '  schema_list:',
    '    - schema: rime_ice',
    '    - schema: double_pinyin_flypy',
    '  menu:',
    "    page_size: 7",
    "",
  ].join("\n"),
};

const MOCK_DEPLOY_RESULT: DeployResult = {
  ok: true,
  log: [
    "[19:28:01] 读取用户目录 ~/Library/Rime",
    "[19:28:01] 校验 default.custom.yaml",
    "[19:28:02] 编译 rime_ice.schema.yaml -> build/rime_ice.schema.yaml",
    "[19:28:02] 写入 build/rime_ice.prism.bin",
    "[19:28:02] 部署完成，耗时 1.24s",
  ].join("\n"),
};

const MOCK_WRITE_RESULT: WriteResult = {
  written_files: ["~/Library/Rime/default.custom.yaml", "~/Library/Rime/squirrel.custom.yaml"],
};

/** mock 的输入设置：与 `MOCK_PROFILE` 里默认启用的三个方案保持一致。 */
const MOCK_INPUT_SETTINGS: InputSettings = {
  schema_list: ["rime_ice", "double_pinyin_flypy", "luna_pinyin"],
  page_size: 7,
  page_keys: "comma_period",
  toggle_ascii: "control_shift_space",
};

/** mock 模式下模拟真实写回：保存后 `get_input_settings` / `scan_profile` 都能读到新值。 */
let mockInputSettings: InputSettings = cloneInputSettings(MOCK_INPUT_SETTINGS);

function cloneInputSettings(settings: InputSettings): InputSettings {
  return { ...settings, schema_list: [...settings.schema_list] };
}

// --- 模糊音 / 方案详情 mock -------------------------------------------------

/** 与 Rust `qieyun_kit::fuzzy::FuzzyGroup` 一一对应的 7 个分组（顺序也一致）。 */
const MOCK_FUZZY_GROUPS: ReadonlyArray<Omit<FuzzyGroup, "enabled">> = [
  { id: "zh-z", label: "zh ↔ z", rules: ["derive/^zh/z/"] },
  { id: "ch-c", label: "ch ↔ c", rules: ["derive/^ch/c/"] },
  { id: "sh-s", label: "sh ↔ s", rules: ["derive/^sh/s/"] },
  { id: "n-l", label: "n ↔ l", rules: ["derive/^n/l/", "derive/^l/n/"] },
  { id: "f-h", label: "f ↔ h", rules: ["derive/^f/h/", "derive/^h/f/"] },
  {
    id: "nasal",
    label: "前后鼻音（an/ang、en/eng、in/ing）",
    rules: [
      "derive/([aeiou])ng$/$1n/",
      "derive/([aeiou])n$/$1ng/",
      "derive/in$/ing/",
      "derive/ing$/in/",
    ],
  },
  { id: "r-l", label: "r ↔ l", rules: ["derive/^r/l/", "derive/^l/r/"] },
];

/**
 * mock 里每个方案「原始」的 algebra（不含模糊音规则）。
 * 应用模糊音后，`get_schema_detail()` 返回的就是 原始规则 + 勾选组规则，
 * 与后端「先剥离再重建」的结果保持一致。
 */
const MOCK_BASE_ALGEBRA: Record<string, string[]> = {
  rime_ice: [
    "derive/^([jqxy])u$/$1v/",
    "derive/^([a-z]).+$/$1/",
    "abbrev/^([a-z]).+$/$1/",
  ],
  double_pinyin_flypy: ["xform/^([a-z])$/$1/", "derive/^([jqxy])u$/$1v/"],
  double_pinyin_abc: ["xform/^([a-z])$/$1/"],
  luna_pinyin: ["derive/^([a-z]).+$/$1/"],
  wubi86: ["derive/^([a-z]).+$/$1/"],
};

/** mock 的模糊音状态：schema_id → 已应用的模糊音组 id。 */
const mockFuzzyApplied: Record<string, string[]> = { rime_ice: ["zh-z"] };

interface MockSchemaDetail {
  name: string;
  source: SchemaSource;
  punctuator: unknown;
  switches: SchemaSwitch[];
  is_shuangpin: boolean;
}

const MOCK_SCHEMA_DETAILS: Record<string, MockSchemaDetail> = {
  rime_ice: {
    name: "雾凇拼音",
    source: "build",
    punctuator: {
      half_shape: {
        " ": " ",
        ",": "，",
        ".": "。",
        "\\": "、",
        "/": { commit: "/" },
        "-": { commit: "-" },
        "[": { pair: ["「", "」"] },
        "]": { pair: ["『", "』"] },
        "{": { commit: "「" },
        "}": { commit: "」" },
      },
      full_shape: {
        " ": { commit: "　" },
        ",": "，",
        ".": "。",
        ":": "：",
        ";": "；",
        "!": "！",
        "?": "？",
        "(": "（",
        ")": "）",
      },
    },
    switches: [
      { name: "ascii_mode", states: ["中文", "英文"], reset: 0 },
      { name: "full_shape", states: ["半角", "全角"], reset: 0 },
      { name: "simplification", states: ["简体", "繁體"], reset: 1 },
      { name: "emoji", states: ["禁止", "允许"], reset: 0 },
    ],
    is_shuangpin: false,
  },
  double_pinyin_flypy: {
    name: "小鹤双拼",
    source: "build",
    punctuator: null,
    switches: [{ name: "ascii_mode", states: ["中文", "英文"], reset: 0 }],
    is_shuangpin: true,
  },
  double_pinyin_abc: {
    name: "智能 ABC 双拼",
    source: "user",
    punctuator: null,
    switches: [],
    is_shuangpin: true,
  },
  luna_pinyin: {
    name: "朙月拼音",
    source: "shared",
    punctuator: null,
    switches: [{ name: "ascii_mode", states: ["中文", "英文"], reset: 0 }],
    is_shuangpin: false,
  },
};

function mockSchemaName(id: string): string {
  return (
    MOCK_SCHEMA_DETAILS[id]?.name ??
    MOCK_PROFILE.schemas.find((schema) => schema.id === id)?.name ??
    id
  );
}

function mockIsShuangpin(id: string): boolean {
  return (
    MOCK_SCHEMA_DETAILS[id]?.is_shuangpin ??
    MOCK_PROFILE.schemas.find((schema) => schema.id === id)?.is_shuangpin ??
    false
  );
}

function mockFuzzyRules(groupIds: readonly string[]): string[] {
  return groupIds.flatMap(
    (id) => MOCK_FUZZY_GROUPS.find((group) => group.id === id)?.rules ?? [],
  );
}

/** 当前 mock 的 algebra：原始规则 + 已应用模糊音规则（去重）。 */
function mockAlgebra(schemaId: string): string[] {
  const base = MOCK_BASE_ALGEBRA[schemaId] ?? [];
  const extra = mockFuzzyRules(mockFuzzyApplied[schemaId] ?? []).filter(
    (rule) => !base.includes(rule),
  );
  return [...base, ...extra];
}

/** 与后端 `fuzzy::detect` 一致：一组规则全部存在才算启用。 */
function mockDetectFuzzy(algebra: readonly string[]): string[] {
  return MOCK_FUZZY_GROUPS.filter((group) =>
    group.rules.every((rule) => algebra.includes(rule)),
  ).map((group) => group.id);
}

function mockSchemaDetail(schemaId?: string): SchemaDetail {
  const id = schemaId ?? mockInputSettings.schema_list[0] ?? MOCK_PROFILE.default_schema;
  const known = MOCK_SCHEMA_DETAILS[id];
  return {
    id,
    name: mockSchemaName(id),
    source: known?.source ?? "missing",
    algebra: known ? mockAlgebra(id) : [],
    punctuator: known?.punctuator ?? null,
    switches: known?.switches.map((item) => ({ ...item, states: [...item.states] })) ?? [],
    is_shuangpin: mockIsShuangpin(id),
  };
}

function mockFuzzySettings(): FuzzySettings {
  const id = mockInputSettings.schema_list[0] ?? MOCK_PROFILE.default_schema;
  const algebra = mockAlgebra(id);
  const enabled = mockDetectFuzzy(algebra);
  return {
    schema_id: id,
    schema_name: mockSchemaName(id),
    compiled: MOCK_SCHEMA_DETAILS[id]?.source === "build",
    rule_count: algebra.length,
    groups: MOCK_FUZZY_GROUPS.map((group) => ({
      ...group,
      rules: [...group.rules],
      enabled: enabled.includes(group.id),
    })),
  };
}


/** 主题写回只会落在当前平台的样式文件上。 */
const MOCK_THEME_WRITE_RESULT: WriteResult = {
  written_files: ["~/Library/Rime/squirrel.custom.yaml"],
};

const MOCK_TAKEOVER_PLAN: TakeoverPlan = {
  taken_over: false,
  user_dir: "~/Library/Rime",
  schema_count: 5,
  custom_files: ["default.custom.yaml"],
  snapshot_dir: "~/Library/Rime/.qieyun/snapshots",
};

/** mock 模式下模拟接管状态的变化，让「备份并接管 → 重新拉取」在浏览器里也成立。 */
let mockTakenOver = false;

const MOCK_THEME_PRESETS: ThemePreset[] = [
  {
    name: "Qieyun Dark",
    font: { face: "PingFang SC", point: 14, label_point: 12, line_spacing: 2 },
    layout: {
      orientation: "horizontal",
      corner_radius: 8,
      border_width: 1,
      margin: 8,
      spacing: 6,
      shadow: 4,
    },
    colors: {
      back: "#1E1E1E",
      border: "#FFFFFF1A",
      text: "#E6E6E6",
      candidate_text: "#CCCCCC",
      comment_text: "#8A8A8A",
      hilited_back: "#2A2A2A",
      hilited_text: "#FFFFFF",
      hilited_candidate_back: "#3A6EA5",
      hilited_candidate_text: "#FFFFFF",
      hilited_candidate_border: "#00000000",
      hilited_border: "#00000000",
    },
  },
  {
    name: "Qieyun Light",
    font: { face: "PingFang SC", point: 15, label_point: 12, line_spacing: 3 },
    layout: {
      orientation: "horizontal",
      corner_radius: 6,
      border_width: 1,
      margin: 8,
      spacing: 6,
      shadow: 2,
    },
    colors: {
      back: "#FAFAFA",
      border: "#0000001A",
      text: "#1E1E1E",
      candidate_text: "#333333",
      comment_text: "#888888",
      hilited_back: "#ECECEC",
      hilited_text: "#000000",
      hilited_candidate_back: "#1B6EF0",
      hilited_candidate_text: "#FFFFFF",
      hilited_candidate_border: "#00000000",
      hilited_border: "#00000000",
    },
  },
];

function mockTakeoverSnapshotId(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 调用封装
// ---------------------------------------------------------------------------

class IpcError extends Error {
  constructor(
    readonly command: IpcCommand,
    readonly cause: unknown,
  ) {
    // Tauri 的 reject 值通常是后端 `Err(String)` 的中文原文；
    // 直接透出原文，页面才能把「这些键被手动修改过，已中止写入」之类的信息展示给用户。
    super(describeError(cause));
    this.name = "IpcError";
  }
}

function describeError(cause: unknown): string {
  if (typeof cause === "string" && cause.trim()) return cause;
  if (cause instanceof Error && cause.message) return cause.message;
  if (cause && typeof cause === "object") {
    try {
      const text = JSON.stringify(cause);
      if (text && text !== "{}") return text;
    } catch {
      // 忽略不可序列化的值，走兜底。
    }
  }
  return String(cause);
}

async function call<K extends IpcCommand>(
  command: K,
  args: IpcContract[K]["args"],
  mock: () => IpcContract[K]["result"],
): Promise<IpcContract[K]["result"]> {
  if (!hasTauriBackend()) {
    // 模拟一点点网络/进程延迟，避免 loading 状态闪一下就消失。
    await delay(120);
    return mock();
  }

  try {
    return await invoke<IpcContract[K]["result"]>(
      command,
      args as Record<string, unknown> | undefined,
    );
  } catch (error) {
    throw new IpcError(command, error);
  }
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

export const ipc = {
  getEnvInfo(): Promise<EnvInfo> {
    return call("get_env_info", undefined, () => MOCK_ENV);
  },

  scanProfile(): Promise<Profile> {
    return call("scan_profile", undefined, () => {
      // mock 下让 enabled / default_schema 跟随最近的 apply_input_settings，
      // 这样「保存后重新扫描」在浏览器里也能看到状态变化。
      const enabled = new Set(mockInputSettings.schema_list);
      return {
        ...MOCK_PROFILE,
        schemas: MOCK_PROFILE.schemas.map((schema) => ({
          ...schema,
          enabled: enabled.has(schema.id),
        })),
        default_schema: mockInputSettings.schema_list[0] ?? MOCK_PROFILE.default_schema,
      };
    });
  },

  listSnapshots(): Promise<Snapshot[]> {
    return call("list_snapshots", undefined, () => mockSnapshots.map((item) => ({ ...item })));
  },

  createSnapshot(note: string): Promise<{ id: string }> {
    return call("create_snapshot", { note }, () => {
      const id = mockUniqueSnapshotId();
      mockSnapshots = [{ id, created_at: mockStamp(), note }, ...mockSnapshots];
      return { id };
    });
  },

  deploy(): Promise<DeployResult> {
    return call("deploy", undefined, () => {
      mockRecordDeploy(MOCK_DEPLOY_RESULT.log);
      return MOCK_DEPLOY_RESULT;
    });
  },

  readFile(path: string): Promise<FileContent> {
    return call("read_file", { path }, () => {
      // mock 里按文件名命中用户目录的清单；未命中的路径退回通用样例（兼容旧调用方）。
      const name = path.replace(/^.*[/\\]/, "");
      const known = mockUserFiles[name];
      return known ? { content: known.content } : MOCK_FILE_CONTENT;
    });
  },

  writeGuiConfig(patch: GuiPatch): Promise<WriteResult> {
    return call("write_gui_config", { patch }, () => MOCK_WRITE_RESULT);
  },

  getTakeoverPlan(): Promise<TakeoverPlan> {
    return call("get_takeover_plan", undefined, () => ({
      ...MOCK_TAKEOVER_PLAN,
      taken_over: mockTakenOver,
    }));
  },

  acceptTakeover(): Promise<TakeoverResult> {
    return call("accept_takeover", undefined, () => {
      mockTakenOver = true;
      return {
        snapshot_id: mockTakeoverSnapshotId(),
        user_dir: MOCK_TAKEOVER_PLAN.user_dir,
      };
    });
  },

  listThemePresets(): Promise<ThemePreset[]> {
    return call("list_theme_presets", undefined, () => MOCK_THEME_PRESETS);
  },

  applyTheme(theme: ThemePreset): Promise<WriteResult> {
    return call("apply_theme", { theme }, () => MOCK_THEME_WRITE_RESULT);
  },

  getInputSettings(): Promise<InputSettings> {
    return call("get_input_settings", undefined, () => cloneInputSettings(mockInputSettings));
  },

  applyInputSettings(settings: InputSettings): Promise<WriteResult> {
    return call("apply_input_settings", { settings }, () => {
      mockInputSettings = cloneInputSettings(settings);
      return { written_files: ["~/Library/Rime/default.custom.yaml"] };
    });
  },

  getSchemaDetail(schemaId?: string): Promise<SchemaDetail> {
    // 契约上参数叫 `schema_id`；但 Rust 的 `get_schema_detail(schema_id: Option<String>)`
    // 没写 `rename_all = "snake_case"`，Tauri 2 默认按 camelCase 取 key（schemaId）。
    // 这里两种拼写都带上：Tauri 只读它认识的那个键，后端将来补上 rename_all 也不会坏。
    const args =
      schemaId === undefined
        ? ({} as { schema_id?: string })
        : ({ schema_id: schemaId, schemaId } as { schema_id?: string });
    return call("get_schema_detail", args, () => mockSchemaDetail(schemaId));
  },

  getFuzzySettings(): Promise<FuzzySettings> {
    return call("get_fuzzy_settings", undefined, () => mockFuzzySettings());
  },

  applyFuzzySettings(schemaId: string, groups: string[]): Promise<WriteResult> {
    return call("apply_fuzzy_settings", { schema_id: schemaId, groups }, () => {
      const unknown = groups.find(
        (id) => !MOCK_FUZZY_GROUPS.some((group) => group.id === id),
      );
      if (unknown) throw new Error(`未知的模糊音组：${unknown}`);
      if (mockAlgebra(schemaId).length === 0) {
        throw new Error(
          `读不到方案 ${schemaId} 的 speller/algebra——请先在输入法里部署一次，或确认方案已安装。`,
        );
      }
      // 后端会整段重建 algebra；mock 里记下选择，让重新拉取能看到结果。
      mockFuzzyApplied[schemaId] = [...groups];
      return { written_files: [`~/Library/Rime/${schemaId}.custom.yaml`] };
    });
  },

  applyAndDeploy(): Promise<DeployResult> {
    return call("apply_and_deploy", undefined, () => {
      mockRecordDeploy(MOCK_DEPLOY_RESULT.log);
      return MOCK_DEPLOY_RESULT;
    });
  },

  runDiagnostics(): Promise<DiagnosticsReport> {
    return call("run_diagnostics", undefined, () => mockDiagnostics());
  },

  getDictInventory(): Promise<DictInventory> {
    return call("get_dict_inventory", undefined, () => ({
      dicts: MOCK_DICT_INVENTORY.dicts.map((dict) => ({ ...dict })),
      userdbs: MOCK_DICT_INVENTORY.userdbs.map((db) => ({ ...db })),
      sync_dir: MOCK_DICT_INVENTORY.sync_dir,
      build_artifacts: MOCK_DICT_INVENTORY.build_artifacts,
    }));
  },

  readDeployLog(): Promise<DeployLog> {
    return call("read_deploy_log", undefined, () => ({ ...mockDeployLog }));
  },

  restoreSnapshot(snapshotId: string): Promise<RestoreResult> {
    // Rust 的 `restore_snapshot(snapshot_id: String)` 没有声明 `rename_all = "snake_case"`，
    // Tauri 2 默认按 camelCase 取键；两种拼写都带上，后端补 rename_all 后也不会坏。
    const args = { snapshot_id: snapshotId, snapshotId } as {
      snapshot_id: string;
      snapshotId?: string;
    };
    return call("restore_snapshot", args, () => {
      const backupId = mockUniqueSnapshotId();
      // 与后端一致：恢复前先把当前状态备份成一个新快照。
      mockSnapshots = [
        { id: backupId, created_at: mockStamp(), note: "恢复前自动备份" },
        ...mockSnapshots,
      ];
      return { restored_files: 3, backup_id: backupId };
    });
  },

  revealPath(path: string): Promise<void> {
    return call("reveal_path", { path }, () => undefined);
  },

  /** 用户目录的文件清单（`.yaml` / `.yml` / `.txt`），已按文件名排序。 */
  listUserFiles(): Promise<UserFile[]> {
    return call("list_user_files", undefined, () => mockUserFileList());
  },

  /**
   * 高级页原始写入：绕过 GUI 校验，后端先校验 YAML 合法、自动快照，再原子落盘。
   * 失败时抛出的 message 就是 Rust `Err(String)` 原文，页面必须原样展示。
   */
  writeRawFile(name: string, content: string): Promise<RawWriteResult> {
    return call("write_raw_file", { name, content }, () => {
      const invalid = mockRawEditableName(name);
      if (invalid) throw new Error(invalid);
      const yamlError = mockYamlError(content);
      if (yamlError) throw new Error(`处理 ${name} 失败：YAML 解析失败：${yamlError}`);

      const previous = mockUserFiles[name];
      const kind: UserFileKind = previous?.kind ?? "other";
      const bytes = mockByteLength(content);
      const snapshotId = mockUniqueSnapshotId();
      // 与后端一致：写盘前先整包快照，并把快照登记到快照列表。
      mockSnapshots = [
        { id: snapshotId, created_at: mockStamp(), note: "高级页原始编辑" },
        ...mockSnapshots,
      ];
      mockUserFiles[name] = {
        kind,
        editable: true,
        modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        content,
      };
      return { snapshot_id: snapshotId, bytes };
    });
  },

  /** 删除 `.qieyun/state.json`（只清「哪些键归 GUI 管」的记录，不动任何配置）。 */
  resetManagedKeys(): Promise<DangerResult> {
    return call("reset_managed_keys", undefined, () => {
      const removed = mockManagedKeysPresent;
      mockManagedKeysPresent = false;
      return { removed };
    });
  },

  /** 删除残留的 `.qieyun/deploy.lock`；仅在确认没有部署进行中时使用。 */
  clearDeployLock(): Promise<DangerResult> {
    return call("clear_deploy_lock", undefined, () => {
      const removed = mockDeployLockPresent;
      mockDeployLockPresent = false;
      return { removed };
    });
  },

  /** 解析最近一次部署日志（`.qieyun/last-deploy.log`）。 */
  parseDeployLog(): Promise<ParsedDeployLog> {
    return call("parse_deploy_log", undefined, () => mockParseDeployLog());
  },
};

export type IpcApi = typeof ipc;
