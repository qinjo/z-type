import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  /** 标签与控件左右排布（默认）或上下排布。 */
  layout?: "row" | "stack";
  className?: string;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  layout = "row",
  className,
}: FieldProps) {
  return (
    <div
      className={cn(
        "gap-3 border-b border-line-soft py-3 first:pt-0 last:border-b-0 last:pb-0",
        layout === "row" ? "flex items-start justify-between" : "flex flex-col",
        className,
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[13px] text-text">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs leading-5 text-faint">{hint}</p>}
      </div>
      <div className={cn("shrink-0", layout === "stack" && "w-full")}>{children}</div>
    </div>
  );
}
