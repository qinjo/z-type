import { useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon, type IconName } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import {
  ipc,
  type CheckStatus,
  type DiagnosticsCheck,
} from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type Busy = "deploy" | "restore" | null;

/** 失败置顶，其次提醒，最后通过；同状态内保持后端返回顺序。 */
const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };
const STATUS_LABEL: Record<CheckStatus, string> = { ok: "通过", warn: "提醒", fail: "失败" };
const STATUS_TONE = { ok: "ok", warn: "warn", fail: "danger" } as const;
const STATUS_ICON: Record<CheckStatus, IconName> = {
  ok: "check",
  warn: "warning",
  fail: "warning",
};
const STATUS_TEXT = {
  ok: "text-ok",
  warn: "text-warn",
  fail: "text-danger",
} as const;
const STATUS_BAR = {
  ok: "bg-ok/70",
  warn: "bg-warn/80",
  fail: "bg-danger",
} as const;

function sortedChecks(checks: DiagnosticsCheck[]): DiagnosticsCheck[] {
  return [...checks].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
}

export function Diagnostics() {
  const report = useIpcQuery(() => ipc.runDiagnostics());
  const log = useIpcQuery(() => ipc.readDeployLog());
  const snapshots = useIpcQuery(() => ipc.listSnapshots());
  const env = useIpcQuery(() => ipc.getEnvInfo());

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const [confirmingRestore, setConfirmingRestore] = useState(false);

  const checks = useMemo(
    () => sortedChecks(report.data?.checks ?? []),
    [report.data],
  );
  const latestSnapshot = snapshots.data?.[0] ?? null;

  /** 部署会改变 build/ 与 stale 状态，因此日志和体检都要重新拉取。 */
  async function saveAndDeploy() {
    if (busy) return;
    setBusy("deploy");
    setActionError(null);
    try {
      const result = await ipc.applyAndDeploy();
      toast(
        result.ok ? "已保存并部署" : "部署失败，请查看下方日志",
        result.ok ? "ok" : "danger",
      );
      setLogOpen(true);
      log.reload();
      report.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存并部署失败，后端已中止", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function restoreLatest() {
    if (busy || !latestSnapshot) return;
    setBusy("restore");
    setActionError(null);
    try {
      const result = await ipc.restoreSnapshot(latestSnapshot.id);
      const backup = result.backup_id
        ? ` · 已先自动备份（${result.backup_id}）`
        : "";
      toast(`已恢复 ${result.restored_files} 个文件${backup}`, "ok");
      setConfirmingRestore(false);
      snapshots.reload();
      report.reload();
      log.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("恢复快照失败，当前配置未被覆盖", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function copyLog() {
    const content = log.data?.content ?? "";
    if (!content) {
      toast("没有可复制的日志", "danger");
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      toast("部署日志已复制", "ok");
    } catch {
      toast("当前环境不允许访问剪贴板，请手动选择文本复制", "danger");
    }
  }

  /** 体检结果整体失败时的兜底卡片（后端不可用 / IPC 拒绝）。 */
  if (!report.data && report.error) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="诊断与日志"
          description="这里只报告机器能判断的问题；每条都附下一步动作。"
          actions={
            <Button size="sm" onClick={report.reload}>
              <Icon name="search" size={14} />
              重新体检
            </Button>
          }
        />
        <Card title="体检结果" description="run_diagnostics()">
          <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
            体检失败：{report.error}
          </p>
        </Card>
      </div>
    );
  }

  const data = report.data;

  return (
    <div className="space-y-5">
      <PageHeader
        title="诊断与日志"
        description="这里只报告机器能判断的问题；每条都附下一步动作。"
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setActionError(null);
                setConfirmingRestore(true);
              }}
              disabled={busy !== null || !latestSnapshot}
              title={
                latestSnapshot
                  ? `恢复快照 ${latestSnapshot.id}`
                  : "还没有可恢复的快照"
              }
            >
              <Icon name="snapshot" size={14} />
              恢复上一个快照
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={report.reload}
              disabled={busy !== null || report.loading}
            >
              <Icon name="diagnostics" size={14} />
              {report.loading ? "体检中…" : "重新体检"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={saveAndDeploy}
              disabled={busy !== null}
            >
              <Icon name="deploy" size={14} />
              {busy === "deploy" ? "部署中…" : "保存并部署"}
            </Button>
          </>
        }
      />

      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5"
        >
          <span className="mt-0.5 shrink-0 text-danger">
            <Icon name="warning" size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-danger">操作未完成</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs leading-5 text-danger/90">
              {actionError}
            </p>
          </div>
        </div>
      )}

      {report.error && data && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-warn/35 bg-warn/10 px-3 py-2.5 text-xs text-warn"
        >
          <span className="min-w-0 break-words">刷新体检失败：{report.error}</span>
          <Button size="sm" variant="ghost" onClick={report.reload}>
            重试
          </Button>
        </div>
      )}

      {confirmingRestore && latestSnapshot && (
        <div
          role="alertdialog"
          aria-label="确认恢复快照"
          className="flex items-start justify-between gap-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">确认恢复上一个快照？</p>
            <p className="mt-0.5 break-words text-2xs leading-5 text-warn/90">
              将用 {latestSnapshot.id}（{latestSnapshot.created_at} ·{" "}
              {latestSnapshot.note || "无备注"}）覆盖当前配置；恢复前后端会先把当前状态自动备份成新快照。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingRestore(false)}
              disabled={busy !== null}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={restoreLatest}
              disabled={busy !== null}
            >
              {busy === "restore" ? "恢复中…" : "确认恢复"}
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">通过</p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular text-ok">
            {data?.ok ?? "—"}
          </p>
          <p className="mt-0.5 text-2xs text-faint">机器判定正常</p>
        </Card>
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">提醒</p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular text-warn">
            {data?.warn ?? "—"}
          </p>
          <p className="mt-0.5 text-2xs text-faint">能用，但值得处理</p>
        </Card>
        <Card
          className={cn(data && data.fail > 0 && "border-danger/35")}
        >
          <p className="text-2xs uppercase tracking-wide text-faint">失败</p>
          <p className="mt-1 text-lg font-semibold tracking-tight tabular text-danger">
            {data?.fail ?? "—"}
          </p>
          <p className="mt-0.5 text-2xs text-faint">不处理会直接影响使用</p>
        </Card>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-4">
        <Card
          title="检查项"
          description={
            data
              ? `run_diagnostics() · 共 ${data.checks.length} 项 · 失败置顶`
              : "run_diagnostics()"
          }
          actions={
            data && data.fail > 0 ? (
              <Badge tone="danger" dot>
                {data.fail} 项失败
              </Badge>
            ) : data && data.warn > 0 ? (
              <Badge tone="warn" dot>
                {data.warn} 项提醒
              </Badge>
            ) : (
              <Badge tone="ok" dot>
                全部通过
              </Badge>
            )
          }
          flush
        >
          {report.loading && !data ? (
            <p className="px-4 py-6 text-center text-xs text-faint">体检中…</p>
          ) : checks.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-faint">
              后端没有返回任何检查项。
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {checks.map((check) => (
                <li key={check.id} className="flex items-start gap-3 px-4 py-3">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 h-9 w-1 shrink-0 rounded-full",
                      STATUS_BAR[check.status],
                    )}
                  />
                  <span className={cn("mt-1 shrink-0", STATUS_TEXT[check.status])}>
                    <Icon name={STATUS_ICON[check.status]} size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="text-xs font-medium text-text">{check.title}</p>
                      <span className="font-mono text-2xs text-faint/70">
                        {check.id}
                      </span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-2xs leading-5 text-muted">
                      {check.detail}
                    </p>
                    {check.hint && (
                      <p className="mt-1 flex items-start gap-1.5 text-2xs leading-5 text-faint">
                        <span aria-hidden="true" className="shrink-0 text-accent">
                          →
                        </span>
                        <span className="min-w-0 break-words">{check.hint}</span>
                      </p>
                    )}
                  </div>
                  <Badge tone={STATUS_TONE[check.status]}>
                    {STATUS_LABEL[check.status]}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="环境" description="get_env_info()">
            {env.error ? (
              <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
                读取失败：{env.error}
              </p>
            ) : !env.data ? (
              <p className="text-xs text-faint">读取中…</p>
            ) : (
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">平台</dt>
                  <dd className="truncate text-right text-text">{env.data.platform}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">librime</dt>
                  <dd className="font-mono text-text">{env.data.rime_version}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">用户目录</dt>
                  <dd
                    className="min-w-0 truncate text-right font-mono text-2xs text-text"
                    title={env.data.rime_user_dir}
                  >
                    {env.data.rime_user_dir}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">共享目录</dt>
                  <dd
                    className="min-w-0 truncate text-right font-mono text-2xs text-muted"
                    title={env.data.shared_dir}
                  >
                    {env.data.shared_dir || "—"}
                  </dd>
                </div>
              </dl>
            )}
          </Card>

          <Card title="最近快照" description="list_snapshots() · 第一条用于快捷恢复">
            {snapshots.error ? (
              <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
                读取失败：{snapshots.error}
              </p>
            ) : !snapshots.data ? (
              <p className="text-xs text-faint">读取中…</p>
            ) : latestSnapshot ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-2xs text-text">
                    {latestSnapshot.id}
                  </span>
                  <Badge tone="neutral">{latestSnapshot.created_at}</Badge>
                </div>
                <p className="mt-1.5 break-words text-2xs text-faint">
                  {latestSnapshot.note || "无备注"}
                </p>
                <p className="mt-2 text-2xs leading-5 text-faint">
                  共 {snapshots.data.length} 个快照；恢复前会自动备份当前配置。
                </p>
              </div>
            ) : (
              <p className="text-xs leading-5 text-faint">
                还没有快照，可在「词典」页新建。
              </p>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="部署日志"
        description="read_deploy_log() · 最近一次部署输出"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={log.data?.exists ? "ok" : "neutral"} dot>
              {log.data?.exists ? "有记录" : "无记录"}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={copyLog}
              disabled={!log.data?.content}
            >
              复制
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={log.reload}
              disabled={log.loading}
            >
              <Icon name="search" size={14} />
              刷新
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLogOpen((open) => !open)}
            >
              {logOpen ? "收起日志" : "展开日志"}
            </Button>
          </div>
        }
      >
        {log.error ? (
          <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
            读取部署日志失败：{log.error}
          </p>
        ) : log.loading && !log.data ? (
          <p className="text-xs text-faint">读取中…</p>
        ) : log.data?.exists === false ? (
          <div className="rounded-md border border-line-soft bg-base/40 px-3 py-6 text-center">
            <p className="text-xs text-muted">还没有部署记录</p>
            <p className="mt-1 text-2xs leading-5 text-faint">
              点右上角「保存并部署」后，这里会显示最近一次部署的完整输出。
            </p>
          </div>
        ) : logOpen ? (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base/60 p-3 font-mono text-2xs leading-5 text-muted">
            {log.data?.content || "（部署器未返回日志）"}
          </pre>
        ) : (
          <p className="text-2xs text-faint">
            日志已收起（{log.data?.content.split("\n").length ?? 0} 行）。
          </p>
        )}
      </Card>
    </div>
  );
}
