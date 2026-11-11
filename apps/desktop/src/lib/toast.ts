/**
 * 极简全局 toast 通道。
 *
 * `App.tsx` 在布局层持有唯一的 toast 视口；页面只需要调用 `toast()` 发事件，
 * 避免每个页面各起一个固定定位的浮层互相遮挡。
 */

export type ToastTone = "ok" | "danger" | "neutral";

export interface ToastDetail {
  message: string;
  tone: ToastTone;
}

export const TOAST_EVENT = "qieyun:toast";

export function toast(message: string, tone: ToastTone = "neutral"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { message, tone } }),
  );
}

/** 把任意 catch 到的错误转成可展示文案（IPC 层已把后端中文原文放进 message）。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return String(error);
}
