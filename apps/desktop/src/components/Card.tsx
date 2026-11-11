import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** 去掉内容区内边距，用于表格等贴边内容。 */
  flush?: boolean;
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  flush = false,
}: CardProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-panel shadow-panel",
        className,
      )}
    >
      {(title || description || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold text-text">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cn(flush ? "" : "p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
