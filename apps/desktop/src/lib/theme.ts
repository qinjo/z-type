/**
 * 主题颜色工具：契约里的颜色是 `#RRGGBB` / `#RRGGBBAA`（大写或小写均可），
 * 这里统一做「规范化 + 校验 + CSS 降级」，供编辑页与预览共用。
 */

import { THEME_COLOR_SLOTS, type ThemeColorSlot, type ThemePreset } from "@/lib/ipc";

const HEX_RE = /^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/** 规范化成 `#RRGGBB` 或 `#RRGGBBAA`；非法输入返回 null。 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (!HEX_RE.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

export function isValidHex(input: string): boolean {
  return normalizeHex(input) !== null;
}

/** 用于 CSS 的颜色；非法时退化为 fallback，避免预览崩掉。 */
export function cssColor(input: string, fallback = "transparent"): string {
  return normalizeHex(input) ?? fallback;
}

/** `<input type="color">` 只接受 `#RRGGBB`。 */
export function rgbHex(input: string): string {
  const normalized = normalizeHex(input);
  return normalized ? normalized.slice(0, 7) : "#000000";
}

/** 0–255 的 alpha；不带 alpha 时视为不透明。 */
export function alphaOf(input: string): number {
  const normalized = normalizeHex(input);
  return normalized && normalized.length === 9 ? Number.parseInt(normalized.slice(7), 16) : 255;
}

/** 保留原 alpha，仅替换 RGB（给颜色选择器用）。 */
export function withRgb(input: string, rgb: string): string {
  const normalized = normalizeHex(input);
  const alpha = normalized && normalized.length === 9 ? normalized.slice(7) : "";
  return `${rgb.toUpperCase()}${alpha}`;
}

/** 设置 alpha；255 时退化为 6 位 hex，与后端 `to_hex` 的表示一致。 */
export function withAlpha(input: string, alpha: number): string {
  const clamped = Math.min(255, Math.max(0, Math.round(alpha)));
  const rgb = rgbHex(input);
  return clamped >= 255 ? rgb : `${rgb}${clamped.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** 深拷贝一个预设，作为可编辑草稿；保证 11 个槽位齐全。 */
export function cloneTheme(theme: ThemePreset): ThemePreset {
  const colors: Record<string, string> = {};
  for (const slot of THEME_COLOR_SLOTS) {
    colors[slot] = theme.colors[slot] ?? "#000000";
  }
  return {
    name: theme.name,
    font: { ...theme.font },
    layout: { ...theme.layout },
    colors,
  };
}

/** 背景色亮度判断，用于给预设打「深色 / 浅色」标签（不依赖契约里的额外字段）。 */
export function isDarkTheme(theme: ThemePreset): boolean {
  const normalized = normalizeHex(theme.colors.back ?? "");
  if (!normalized) return true;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

/** 校验并规范化主题；返回非法槽位列表。 */
export function validateTheme(theme: ThemePreset): {
  theme: ThemePreset;
  invalidColors: ThemeColorSlot[];
  fontProblem: string | null;
} {
  const colors: Record<string, string> = {};
  const invalidColors: ThemeColorSlot[] = [];
  for (const slot of THEME_COLOR_SLOTS) {
    const normalized = normalizeHex(theme.colors[slot] ?? "");
    if (!normalized) invalidColors.push(slot);
    else colors[slot] = normalized;
  }
  const face = theme.font.face.trim();
  return {
    theme: {
      ...theme,
      font: { ...theme.font, face },
      colors,
    },
    invalidColors,
    fontProblem: face ? null : "字体 face 不能为空",
  };
}
