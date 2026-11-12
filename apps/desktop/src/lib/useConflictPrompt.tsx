import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConflictDialog } from "@/components/ConflictDialog";
import type { ConflictChoice, ConflictResolver } from "@/lib/guiWrite";
import type { WriteConflict } from "@/lib/ipc";
import { toast } from "@/lib/toast";

export interface ConflictPrompt {
  /** 传给 `*WithConflict(...)` 接缝的冲突回调：弹框并等待用户选择。 */
  resolveConflict: ConflictResolver;
  /** 挂在页面根节点上的对话框节点（未打开时渲染 null）。 */
  conflictDialog: ReactNode;
}

/**
 * 写回冲突的统一提交通道：页面不各写一份「弹框 + Promise + toast」。
 *
 * ```tsx
 * const { resolveConflict, conflictDialog } = useConflictPrompt();
 * // ...
 * return <div>…{conflictDialog}</div>;
 * ```
 *
 * 选「保留我的」由本 hook 统一 toast「已保留你的修改」；选「覆盖」不 toast，
 * 交由页面按自身成功流程（刷新 / 部署 / 写入文件清单）继续。
 */
export function useConflictPrompt(): ConflictPrompt {
  const [conflict, setConflict] = useState<WriteConflict | null>(null);
  const pending = useRef<{ resolve: (choice: ConflictChoice) => void } | null>(null);

  const resolveConflict = useCallback<ConflictResolver>((next) => {
    return new Promise<ConflictChoice>((resolve) => {
      // 页面都是「单 busy」串行写回，正常不会并发；万一撞上，先把上一个按「保留」收掉，
      // 避免它的 Promise 永远悬挂、页面一直停在 busy。
      pending.current?.resolve("keep");
      pending.current = { resolve };
      setConflict(next);
    });
  }, []);

  const settle = useCallback((choice: ConflictChoice) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    setConflict(null);
    // 「保留我的」= 取消写入，给一句反馈（不是错误色）。
    if (choice === "keep") toast("已保留你的修改", "neutral");
    current.resolve(choice);
  }, []);

  const conflictDialog = (
    <ConflictDialog
      open={conflict !== null}
      file={conflict?.file ?? ""}
      keys={conflict?.keys ?? []}
      kind={conflict?.kind ?? "unmanaged"}
      onResolve={settle}
      onCancel={() => settle("keep")}
    />
  );

  return { resolveConflict, conflictDialog };
}
