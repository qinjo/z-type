/**
 * 「带冲突确认」的写回接缝。
 *
 * 后端的写命令默认**拒绝**覆盖两类文件内容（结构化错误 `code = "conflict"`）：
 * 用户在 custom 文件里手写、尚未被切韵接管的键（`unmanaged`），以及之前由切韵写入、
 * 之后被手改的键（`drift`）。这里把「识别冲突 → 交给 UI 决定（保留 / 接管）→
 * 需要时带 `adopt: true` 重放」收成一处，页面只需要弹 `ConflictDialog` 并把用户选择回传。
 *
 * 所有写命令都走同一个 `withConflictConfirmation`，页面上没有第二份实现：
 *
 * ```tsx
 * const { resolveConflict, conflictDialog } = useConflictPrompt();
 * const outcome = await applyInputSettingsWithConflict(settings, resolveConflict);
 * if (outcome.status === "kept") return null;   // 用户保留自己的修改，只需 toast（hook 已发）
 * // outcome.result 是 WriteResult
 * ```
 */

import {
  ipc,
  parseWriteConflict,
  type GuiPatch,
  type InputSettings,
  type ThemePreset,
  type WriteConflict,
  type WriteResult,
} from "@/lib/ipc";

export type ConflictChoice = "keep" | "adopt";

/** 冲突时由调用方弹对话框，返回用户选择。 */
export type ConflictResolver = (conflict: WriteConflict) => Promise<ConflictChoice>;

export type WriteOutcome<T> =
  /** 写入成功（可能经过了一次 adopt 重放）。 */
  | { status: "written"; result: T; adopted: WriteConflict | null }
  /** 用户选择保留自己的修改，本次写入已取消（不是错误）。 */
  | { status: "kept"; conflict: WriteConflict };

/**
 * 执行一次写入；冲突时问用户，选 `adopt` 就带 `adopt: true` 重放同一调用。
 *
 * - 用户选 `keep` → 返回 `{ status: "kept" }`，**不要**当成失败 toast 报错；
 * - 用户选 `adopt` → 重放；第二次仍失败则抛原本的错误（结构化或中文原文），
 *   由调用方按普通失败处理（文件可能在此期间又被改动）；
 * - 非冲突错误（`invalid` / `io` / 其他）原样抛出，不弹对话框。
 */
export async function withConflictConfirmation<T>(
  run: (adopt: boolean) => Promise<T>,
  resolve: ConflictResolver,
): Promise<WriteOutcome<T>> {
  let adopted: WriteConflict | null = null;

  try {
    return { status: "written", result: await run(false), adopted };
  } catch (error) {
    const conflict = parseWriteConflict(error);
    if (!conflict) throw error;
    if ((await resolve(conflict)) === "keep") {
      return { status: "kept", conflict };
    }
    adopted = conflict;
  }

  return { status: "written", result: await run(true), adopted };
}

/** 结构化写回（`write_gui_config`）：`adopt` 放在 `GuiPatch` 里。 */
export function writeGuiConfigWithConflict(
  patch: GuiPatch,
  resolve: ConflictResolver,
): Promise<WriteOutcome<WriteResult>> {
  return withConflictConfirmation(
    (adopt) => ipc.writeGuiConfig(adopt ? { ...patch, adopt: true } : patch),
    resolve,
  );
}

/** 外观页「保存 / 保存并部署」：`apply_theme`。 */
export function applyThemeWithConflict(
  theme: ThemePreset,
  resolve: ConflictResolver,
): Promise<WriteOutcome<WriteResult>> {
  return withConflictConfirmation((adopt) => ipc.applyTheme(theme, adopt), resolve);
}

/** 方案与启用 / 按键 / 双拼页：`apply_input_settings`。 */
export function applyInputSettingsWithConflict(
  settings: InputSettings,
  resolve: ConflictResolver,
): Promise<WriteOutcome<WriteResult>> {
  return withConflictConfirmation(
    (adopt) => ipc.applyInputSettings(settings, adopt),
    resolve,
  );
}

/** 模糊音页：`apply_fuzzy_settings`。 */
export function applyFuzzySettingsWithConflict(
  schemaId: string,
  groups: string[],
  resolve: ConflictResolver,
): Promise<WriteOutcome<WriteResult>> {
  return withConflictConfirmation(
    (adopt) => ipc.applyFuzzySettings(schemaId, groups, adopt),
    resolve,
  );
}
