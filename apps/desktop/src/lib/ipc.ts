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
}

export interface DeployResult {
  ok: boolean;
  log: string;
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

const MOCK_SNAPSHOTS: Snapshot[] = [
  { id: "20261111-1928", created_at: "2026-11-11 19:28", note: "初始化工作台" },
  { id: "20261110-2142", created_at: "2026-11-10 21:42", note: "切换默认方案为雾凇拼音" },
  { id: "20261109-1035", created_at: "2026-11-09 10:35", note: "调整候选窗字号" },
];

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
    return call("list_snapshots", undefined, () => MOCK_SNAPSHOTS);
  },

  createSnapshot(note: string): Promise<{ id: string }> {
    return call("create_snapshot", { note }, () => ({
      id: `snapshot-${Date.now().toString(36)}`,
    }));
  },

  deploy(): Promise<DeployResult> {
    return call("deploy", undefined, () => MOCK_DEPLOY_RESULT);
  },

  readFile(path: string): Promise<FileContent> {
    return call("read_file", { path }, () => MOCK_FILE_CONTENT);
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
    return call("apply_and_deploy", undefined, () => MOCK_DEPLOY_RESULT);
  },
};

export type IpcApi = typeof ipc;
