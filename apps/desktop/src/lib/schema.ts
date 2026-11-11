/**
 * 方案详情（`get_schema_detail()`）的展示工具。
 *
 * `punctuator` 在 Rust 侧是原始 `serde_json::Value`：可能是字符串、`{commit: ...}`、
 * `{pair: [开, 闭]}`、数组甚至 null。页面只做可读化渲染，不猜结构、不做编辑。
 */

import type { SchemaSource } from "@/lib/ipc";

export interface SchemaSourceInfo {
  label: string;
  tone: "ok" | "warn" | "danger";
  hint: string;
}

/** 来源提示：`build` 最可靠，`user` / `shared` 都是未部署的原文。 */
export const SCHEMA_SOURCE_INFO: Record<SchemaSource, SchemaSourceInfo> = {
  build: {
    label: "build 编译产物",
    tone: "ok",
    hint: "读取自 build/<id>.schema.yaml，已展开 __include 与 patch，最可靠。",
  },
  user: {
    label: "用户目录原文",
    tone: "warn",
    hint: "读取自用户目录的 <id>.schema.yaml；尚未部署，可能不含 __include 展开。",
  },
  shared: {
    label: "共享目录原文",
    tone: "warn",
    hint: "读取自输入法共享目录的原始 schema；尚未部署，可能不含 __include 展开。",
  },
  missing: {
    label: "未找到",
    tone: "danger",
    hint: "用户目录与共享目录都没有该方案文件。",
  },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把 `punctuator` 里的任意值转成一行可读文本。 */
export function formatPunctValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    if (value === "") return "（空字符串）";
    if (value === " ") return "␣ （空格）";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(formatPunctValue).join(" / ");
  if (isRecord(value)) {
    const parts: string[] = [];
    if ("commit" in value) parts.push(`commit: ${formatPunctValue(value.commit)}`);
    if ("pair" in value) {
      const pair = value.pair;
      parts.push(
        Array.isArray(pair)
          ? `pair: ${pair.map(formatPunctValue).join(" ↔ ")}`
          : `pair: ${formatPunctValue(pair)}`,
      );
    }
    if (parts.length > 0) return parts.join(" · ");
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** 按键列的展示：空格与不可见字符用 `JSON.stringify` 露出转义。 */
export function punctKeyLabel(key: string): string {
  if (key === " ") return "␣";
  return JSON.stringify(key);
}

/** 把对象形态的 `half_shape` / `full_shape` 拆成有序键值对；非对象返回空数组。 */
export function punctEntries(value: unknown): Array<[string, unknown]> {
  return isRecord(value) ? Object.entries(value) : [];
}
