/**
 * M0 阶段的静态展示数据。
 * 这些值只服务于占位 UI 的信息结构验证；后端接入后应替换为 IPC 返回值。
 */

export type Tone = "ok" | "warn" | "danger" | "neutral" | "accent";

export interface HealthCheck {
  id: string;
  label: string;
  detail: string;
  status: "ok" | "warn" | "fail";
}

export const healthChecks: HealthCheck[] = [
  { id: "user-dir", label: "用户配置目录可读", detail: "~/Library/Rime · 12 个文件", status: "ok" },
  { id: "shared-dir", label: "共享目录已定位", detail: "Squirrel.app/Contents/Resources", status: "ok" },
  { id: "default-schema", label: "默认方案可加载", detail: "rime_ice · 雾凇拼音", status: "ok" },
  { id: "build-dir", label: "构建产物是否最新", detail: "build/ 落后于 3 个 custom.yaml", status: "warn" },
  { id: "userdb", label: "用户词典可写", detail: "rime_ice.userdb · LevelDB", status: "ok" },
  { id: "plugin", label: "插件目录", detail: "未发现 librime-lua 插件", status: "fail" },
];

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: string[];
  active: boolean;
}

export const themePresets: ThemePreset[] = [
  {
    id: "biluo",
    name: "碧落",
    description: "冷灰底 · 靛青强调色，适合长时间书写",
    colors: ["#11161d", "#6ea8fe", "#e6eaf1", "#8b95a5"],
    active: true,
  },
  {
    id: "mingyue",
    name: "明月",
    description: "中性深色 · 暖白高亮，接近系统深色模式",
    colors: ["#151515", "#f2c879", "#f5f5f5", "#9a9a9a"],
    active: false,
  },
  {
    id: "qingci",
    name: "青瓷",
    description: "偏青的暗色 · 低饱和，弱对比",
    colors: ["#0f1a18", "#7fcfc0", "#dcece7", "#7d938d"],
    active: false,
  },
  {
    id: "sujian",
    name: "素笺",
    description: "浅色主题（预留）· 纸面质感",
    colors: ["#f7f4ee", "#8a6f4e", "#2b2b2b", "#8d857a"],
    active: false,
  },
];

export interface KeyBinding {
  id: string;
  action: string;
  binding: string;
  note: string;
}

export const keyBindings: KeyBinding[] = [
  { id: "toggle", action: "中英切换", binding: "Shift", note: "惯用左 Shift 单独切换" },
  { id: "candidate-next", action: "下一页候选", binding: "Tab / .", note: "与标点冲突时优先翻页" },
  { id: "candidate-prev", action: "上一页候选", binding: "Shift+Tab / ,", note: "—" },
  { id: "commit", action: "上屏", binding: "Space", note: "—" },
  { id: "delete", action: "删除/退格", binding: "BackSpace", note: "输入码为空时透传" },
  { id: "ascii-mode", action: "临时 ASCII", binding: "Control+`", note: "仅当前会话生效" },
  { id: "deploy", action: "重新部署", binding: "Control+Option+`", note: "全局快捷键，需系统权限" },
];

export interface FuzzyPair {
  id: string;
  from: string;
  to: string;
  enabled: boolean;
}

export interface FuzzyGroup {
  id: string;
  title: string;
  description: string;
  pairs: FuzzyPair[];
}

export const fuzzyGroups: FuzzyGroup[] = [
  {
    id: "zh",
    title: "翘舌音",
    description: "zh / ch / sh 与 z / c / s 互相容错",
    pairs: [
      { id: "zh-z", from: "zh", to: "z", enabled: true },
      { id: "ch-c", from: "ch", to: "c", enabled: true },
      { id: "sh-s", from: "sh", to: "s", enabled: true },
    ],
  },
  {
    id: "nasal",
    title: "鼻音",
    description: "前后鼻音 -n / -ng 容错",
    pairs: [
      { id: "an-ang", from: "an", to: "ang", enabled: true },
      { id: "en-eng", from: "en", to: "eng", enabled: true },
      { id: "in-ing", from: "in", to: "ing", enabled: false },
    ],
  },
  {
    id: "liquid",
    title: "边音与韵母",
    description: "n / l、ian / iang 等常见混淆",
    pairs: [
      { id: "n-l", from: "n", to: "l", enabled: false },
      { id: "ian-iang", from: "ian", to: "iang", enabled: false },
      { id: "uan-uang", from: "uan", to: "uang", enabled: false },
    ],
  },
];

export interface ShuangpinScheme {
  id: string;
  name: string;
  description: string;
  keys: string;
  sample: string;
  active: boolean;
}

export const shuangpinSchemes: ShuangpinScheme[] = [
  {
    id: "flypy",
    name: "小鹤双拼",
    description: "键位均衡、社区方案最多，雾凇拼音默认搭配",
    keys: "q iu · w ei · e e · r uan · t ue · y un · u sh · i ch · o o · p ie",
    sample: "nihc → 你好",
    active: true,
  },
  {
    id: "natural",
    name: "自然码",
    description: "历史最悠久，兼容大量旧词库",
    keys: "q iu · w ia · e e · r uan · t ue · y ing · u sh · i ch · o o · p ie",
    sample: "nihc → 你好",
    active: false,
  },
  {
    id: "mspy",
    name: "微软双拼",
    description: "Windows 用户迁移成本最低",
    keys: "q iu · w ei · e e · r er · t ue · y un · u sh · i ch · o o · p ie",
    sample: "nihc → 你好",
    active: false,
  },
  {
    id: "ziran",
    name: "紫光双拼",
    description: "单字重码率较低的小众方案",
    keys: "q iu · w ia · e e · r uan · t ue · y un · u sh · i ch · o o · p ie",
    sample: "nihc → 你好",
    active: false,
  },
];

export interface PunctuationRow {
  id: string;
  name: string;
  half: string;
  full: string;
  note: string;
}

export const punctuationRows: PunctuationRow[] = [
  { id: "comma", name: "逗号", half: ",", full: "，", note: "数字之间保留半角" },
  { id: "period", name: "句号", half: ".", full: "。", note: "网址/小数自动转半角" },
  { id: "colon", name: "冒号", half: ":", full: "：", note: "—" },
  { id: "semicolon", name: "分号", half: ";", full: "；", note: "—" },
  { id: "question", name: "问号", half: "?", full: "？", note: "—" },
  { id: "exclam", name: "叹号", half: "!", full: "！", note: "—" },
  { id: "quote", name: "引号", half: '"', full: "「」/“”", note: "成对出现时自动闭合" },
  { id: "bracket", name: "括号", half: "()", full: "（）", note: "—" },
  { id: "dash", name: "破折号", half: "--", full: "——", note: "连续两个减号触发" },
  { id: "ellipsis", name: "省略号", half: "...", full: "……", note: "连续三个点触发" },
];

export interface DictionaryEntry {
  id: string;
  name: string;
  kind: "用户词典" | "方案词库" | "扩展词库";
  size: string;
  entries: string;
  enabled: boolean;
  note: string;
}

export const dictionaries: DictionaryEntry[] = [
  {
    id: "rime_ice",
    name: "rime_ice.userdb",
    kind: "用户词典",
    size: "18.4 MB",
    entries: "42,180",
    enabled: true,
    note: "随部署自动同步",
  },
  {
    id: "luna",
    name: "luna_pinyin.userdb",
    kind: "用户词典",
    size: "6.2 MB",
    entries: "13,904",
    enabled: true,
    note: "长期未使用，可考虑归档",
  },
  {
    id: "ice-dict",
    name: "rime_ice.dict.yaml",
    kind: "方案词库",
    size: "3.8 MB",
    entries: "310,562",
    enabled: true,
    note: "只读 · 由方案仓库提供",
  },
  {
    id: "custom-phrase",
    name: "custom_phrase.txt",
    kind: "扩展词库",
    size: "24 KB",
    entries: "612",
    enabled: false,
    note: "当前方案未引用",
  },
];

export interface ConfigPath {
  id: string;
  label: string;
  path: string;
  kind: "用户目录" | "共享目录" | "构建产物" | "同步目录";
  exists: boolean;
}

export const configPaths: ConfigPath[] = [
  { id: "user-dir", label: "用户配置目录", path: "~/Library/Rime", kind: "用户目录", exists: true },
  {
    id: "shared-dir",
    label: "共享配置目录",
    path: "/Library/Input Methods/Squirrel.app/Contents/Resources",
    kind: "共享目录",
    exists: true,
  },
  { id: "default-custom", label: "全局补丁", path: "~/Library/Rime/default.custom.yaml", kind: "用户目录", exists: true },
  { id: "squirrel-custom", label: "Squirrel 外观", path: "~/Library/Rime/squirrel.custom.yaml", kind: "用户目录", exists: true },
  { id: "build-dir", label: "构建产物", path: "~/Library/Rime/build", kind: "构建产物", exists: true },
  { id: "sync-dir", label: "同步目录", path: "~/Library/Rime/sync", kind: "同步目录", exists: false },
];

export interface DeployLogLine {
  time: string;
  level: "info" | "warn" | "error";
  message: string;
}

export const deployLog: DeployLogLine[] = [
  { time: "19:27:58", level: "info", message: "开始部署 · 用户在设置页触发" },
  { time: "19:27:58", level: "info", message: "校验 default.custom.yaml 语法 … 通过" },
  { time: "19:27:59", level: "warn", message: "squirrel.custom.yaml 中 font_point 缺失，回退默认值 16" },
  { time: "19:28:00", level: "info", message: "编译 rime_ice.schema.yaml → build/rime_ice.schema.yaml" },
  { time: "19:28:01", level: "info", message: "生成 rime_ice.prism.bin / rime_ice.table.bin" },
  { time: "19:28:02", level: "error", message: "插件 librime-lua 未加载，跳过 lua_processor 节点" },
  { time: "19:28:02", level: "info", message: "部署完成 · 1.24s · 5 个方案 · 4 个主题" },
];

export const diagnosticsSteps = [
  { id: "env", label: "环境探测", detail: "用户目录 / 共享目录 / 平台" },
  { id: "parse", label: "配置解析", detail: "所有 *.custom.yaml 的 YAML 语法" },
  { id: "schema", label: "方案完整性", detail: "schema_list、默认方案、词库引用" },
  { id: "build", label: "构建产物", detail: "build/ 时间戳与源文件对比" },
  { id: "dict", label: "词典状态", detail: "userdb 大小、同步目录可写性" },
  { id: "plugin", label: "插件与前端", detail: "librime 版本、插件加载情况" },
];

export const advancedToggles = [
  { id: "diagnostic", label: "启用诊断日志", hint: "在 ~/Library/Rime 写入 rime-studio.log", enabled: true },
  { id: "safe-write", label: "写入前自动快照", hint: "每次保存 custom.yaml 前创建快照", enabled: true },
  { id: "backup-shared", label: "允许修改共享目录", hint: "高风险：会影响所有方案", enabled: false },
  { id: "telemetry", label: "匿名使用统计", hint: "仅上报崩溃与版本号，可随时关闭", enabled: false },
];
