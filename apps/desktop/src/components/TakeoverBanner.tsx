import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ipc } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

interface TakeoverBannerProps {
  /** 接管成功后的回调，例如刷新概览页的快照列表。 */
  onTakenOver?: () => void;
}

/**
 * 首启接管横幅（概览页顶部）。
 *
 * 契约要点：接管 = 整包备份 + 登记托管键，不做任何配置改写；
 * 已接管后只保留一行低调的状态，不再占据首屏。
 */
export function TakeoverBanner({ onTakenOver }: TakeoverBannerProps) {
  const plan = useIpcQuery(() => ipc.getTakeoverPlan());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.acceptTakeover();
      toast(`已备份并接管 · 快照 ${result.snapshot_id}`, "ok");
      plan.reload();
      onTakenOver?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (plan.loading) {
    return (
      <div className="rounded-md border border-line-soft bg-panel/60 px-4 py-2.5 text-xs text-faint">
        读取接管状态…
      </div>
    );
  }

  if (plan.error) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger/5 px-4 py-2.5">
        <p className="text-xs leading-5 text-danger">读取接管状态失败：{plan.error}</p>
        <Button size="sm" variant="ghost" onClick={plan.reload}>
          重试
        </Button>
      </div>
    );
  }

  if (!plan.data) return null;

  if (plan.data.taken_over) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line-soft bg-panel/60 px-3.5 py-2 text-2xs text-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        <span className="text-muted">已接管</span>
        <span className="text-line">·</span>
        <span>{plan.data.schema_count} 个方案</span>
        <span className="text-line">·</span>
        <span>备份目录</span>
        <span className="truncate font-mono text-muted" title={plan.data.snapshot_dir}>
          {plan.data.snapshot_dir}
        </span>
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-accent/35 bg-accent/[0.06] shadow-panel">
      <div className="flex items-start gap-3 border-b border-accent/15 px-4 py-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/35 bg-accent/10 text-accent">
          <Icon name="snapshot" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-semibold text-text">接管现有配置</h2>
            <Badge tone="accent">首次启动</Badge>
            <Badge tone="neutral">尚未接管</Badge>
          </div>
          <p className="mt-0.5 text-xs leading-5 text-muted">
            接管只做整包备份并登记托管键，不改任何配置；之后切韵写入
            <span className="mx-1 font-mono text-2xs text-text">*.custom.yaml</span>
            前都会先检测你手动改过的键。
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          className="shrink-0"
          onClick={accept}
          disabled={busy}
        >
          <Icon name="check" size={14} />
          {busy ? "备份中…" : "备份并接管"}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4 px-4 py-3">
        <div className="min-w-0">
          <p className="text-2xs text-faint">用户目录</p>
          <p className="mt-0.5 truncate font-mono text-xs text-text" title={plan.data.user_dir}>
            {plan.data.user_dir}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-2xs text-faint">已发现方案</p>
          <p className="mt-0.5 text-xs text-text">
            <span className="tabular">{plan.data.schema_count}</span> 个
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-2xs text-faint">备份目录</p>
          <p
            className="mt-0.5 truncate font-mono text-xs text-muted"
            title={plan.data.snapshot_dir}
          >
            {plan.data.snapshot_dir}
          </p>
        </div>
      </div>

      <div className="border-t border-accent/15 px-4 py-3">
        <p className="text-2xs text-faint">将被纳入管理范围的 custom 文件</p>
        {plan.data.custom_files.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {plan.data.custom_files.map((file) => (
              <li
                key={file}
                className="rounded border border-line bg-raised/70 px-1.5 py-0.5 font-mono text-2xs text-muted"
              >
                {file}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs leading-5 text-muted">
            还没有 custom 文件，接管后会按需创建。
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap border-t border-danger/25 bg-danger/5 px-4 py-2.5 font-mono text-2xs leading-5 text-danger"
        >
          {error}
        </p>
      )}
    </section>
  );
}
