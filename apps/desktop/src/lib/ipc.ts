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
}

export interface Profile {
  schemas: SchemaInfo[];
  themes: string[];
  default_schema: string;
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
    { id: "rime_ice", name: "雾凇拼音", enabled: true },
    { id: "double_pinyin_flypy", name: "小鹤双拼", enabled: true },
    { id: "luna_pinyin", name: "朙月拼音", enabled: true },
    { id: "wubi86", name: "五笔 86", enabled: false },
    { id: "cangjie5", name: "仓颉五代", enabled: false },
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
    super(`IPC 命令 ${command} 调用失败`);
    this.name = "IpcError";
  }
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
    return call("scan_profile", undefined, () => MOCK_PROFILE);
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
};

export type IpcApi = typeof ipc;
