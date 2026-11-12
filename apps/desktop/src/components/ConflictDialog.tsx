import { useEffect, useRef } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";

export type ConflictKind = "unmanaged" | "drift";

interface ConflictDialogProps {
  open: boolean;
  /** 冲突所在的 custom 文件，例如 `squirrel.custom.yaml`。 */
  file: string;
  /** 冲突键名（Rime 路径写法，例如 `style/font_point`）。 */
  keys: string[];
  kind: ConflictKind;
  /** 用户做了决定：`keep` = 保留自己的、取消写入；`adopt` = 让切韵接管并覆盖。 */
  onResolve: (choice: "keep" | "adopt") => void;
  /** 关闭对话框但不做决定（Esc / 点遮罩 / 右上角 ×），调用方按 `keep` 处理。 */
  onCancel: () => void;
}

interface KindCopy {
  title: string;
  subtitle: string;
  body: string;
  hint: string;
  badge: string;
}

const COPY: Record<ConflictKind, KindCopy> = {
  unmanaged: {
    title: "这些键是你手写的，切韵还没接管",
    subtitle: "为避免静默覆盖，后端已中止写入",
    body: "文件里有这些键，但切韵没有它们的写入记录（是你自己加进 custom 文件的）。所以这次写回被拒绝，文件没有被改动。",
    hint: "选「用切韵的值覆盖」会把这些键登记为切韵托管：你手写的值会被本次写入覆盖，之后由切韵统一维护。",
    badge: "未托管键",
  },
  drift: {
    title: "这些键之前由切韵写入，之后被手改",
    subtitle: "检测到漂移，后端已中止写入",
    body: "切韵记录的值和文件里的现值不一致（可能你手动改过）。为避免静默覆盖，这次写回被拒绝，文件没有被改动。",
    hint: "选「用切韵的值覆盖」会丢弃你手改的值，并把这批键重新登记为切韵托管。",
    badge: "手改漂移",
  },
};

/**
 * 写回冲突确认对话框。
 *
 * 触发方：`writeGuiConfigWithConflict()` 在 `parseWriteConflict(error)` 命中后打开本对话框，
 * 用户的选择（保留 / 覆盖）直接决定是否带 `adopt: true` 重放写回请求。
 */
export function ConflictDialog({
  open,
  file,
  keys,
  kind,
  onResolve,
  onCancel,
}: ConflictDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const copy = COPY[kind];

  // 只在打开时把焦点放到安全选项（保留我的）上；关掉再打开才会重新聚焦，
  // 避免父组件重渲染时把用户已经 Tab 到「覆盖」上的焦点抢回去。
  useEffect(() => {
    if (!open) return;
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("[data-conflict-safe]")
      ?.focus();
  }, [open]);

  // Esc 等价于取消（保留我的）。
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-dialog-title"
        aria-describedby="conflict-dialog-body"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-panel shadow-panel"
      >
        <header className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3">
          <span className={cn("mt-0.5 shrink-0", kind === "drift" ? "text-warn" : "text-accent")}>
            <Icon name="warning" size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="conflict-dialog-title" className="text-[13px] font-semibold text-text">
                {copy.title}
              </h2>
              <Badge tone={kind === "drift" ? "warn" : "accent"}>{copy.badge}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-faint">{copy.subtitle}</p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="-mr-1 -mt-1 shrink-0 rounded px-1.5 py-0.5 text-sm text-faint transition-colors hover:bg-raised hover:text-text"
          >
            ×
          </button>
        </header>

        <div className="space-y-3 px-4 py-3">
          <p id="conflict-dialog-body" className="text-xs leading-5 text-muted">
            {copy.body}
          </p>

          <div>
            <p className="text-2xs text-faint">文件</p>
            <p className="mt-0.5 truncate font-mono text-xs text-text" title={file}>
              {file}
            </p>
          </div>

          <div>
            <p className="text-2xs text-faint">涉及的键（{keys.length}）</p>
            {keys.length > 0 ? (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {keys.map((key) => (
                  <li
                    key={key}
                    className="rounded border border-line bg-base/60 px-1.5 py-0.5 font-mono text-2xs text-text"
                  >
                    {key}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-2xs text-faint">（后端未给出键名）</p>
            )}
          </div>

          <p className="rounded border border-warn/30 bg-warn/10 px-2.5 py-2 text-2xs leading-5 text-warn">
            {copy.hint}
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
          <Button
            data-conflict-safe=""
            size="sm"
            variant="secondary"
            onClick={() => onResolve("keep")}
          >
            保留我的（取消写入）
          </Button>
          <Button size="sm" variant="danger" onClick={() => onResolve("adopt")}>
            用切韵的值覆盖
          </Button>
        </footer>
      </div>
    </div>
  );
}
