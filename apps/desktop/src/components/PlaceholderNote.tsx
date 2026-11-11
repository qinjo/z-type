import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PlaceholderNoteProps {
  children: ReactNode;
  className?: string;
}

/**
 * 占位说明条：明确标注「M0 阶段只做结构，不接交互」，
 * 避免把静态 mock 误认为已实现功能。
 */
export function PlaceholderNote({ children, className }: PlaceholderNoteProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-dashed border-line bg-base/40 px-3 py-2.5",
        className,
      )}
    >
      <span className="mt-px shrink-0 rounded border border-line bg-raised px-1 py-px font-mono text-2xs text-faint">
        M0
      </span>
      <p className="text-xs leading-5 text-muted">{children}</p>
    </div>
  );
}
