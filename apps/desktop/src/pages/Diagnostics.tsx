import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { deployLog, diagnosticsSteps, healthChecks } from "@/lib/demo-data";
import { ipc } from "@/lib/ipc";
import { useIpcQuery } from "@/lib/useIpcQuery";

const statusTone = { ok: "ok", warn: "warn", fail: "danger" } as const;
const statusText = { ok: "通过", warn: "警告", fail: "异常" } as const;
const levelClass = {
  info: "text-muted",
  warn: "text-warn",
  error: "text-danger",
} as const;

export function Diagnostics() {
  const env = useIpcQuery(() => ipc.getEnvInfo());
  const [running, setRunning] = useState(false);

  function rerun() {
    setRunning(true);
    env.reload();
    window.setTimeout(() => setRunning(false), 600);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="诊断与日志"
        description="体检配置、查看部署日志，并在反馈问题时导出诊断包。这里的所有操作都是只读的。"
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Icon name="external" size={14} />
              导出诊断包
            </Button>
            <Button size="sm" variant="primary" onClick={rerun} disabled={running}>
              <Icon name="diagnostics" size={14} />
              {running ? "体检中…" : "运行体检"}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[1.35fr_1fr] gap-4">
        <Card
          title="体检结果"
          description={`${healthChecks.filter((check) => check.status === "ok").length} / ${healthChecks.length} 项通过`}
          actions={
            <Badge tone="warn" dot>
              存在异常
            </Badge>
          }
          flush
        >
          <ul className="divide-y divide-line-soft">
            {healthChecks.map((check) => (
              <li key={check.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className={`mt-0.5 ${
                    check.status === "ok"
                      ? "text-ok"
                      : check.status === "warn"
                        ? "text-warn"
                        : "text-danger"
                  }`}
                >
                  <Icon name={check.status === "ok" ? "check" : "warning"} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-text">{check.label}</p>
                  <p className="truncate text-2xs text-faint" title={check.detail}>
                    {check.detail}
                  </p>
                </div>
                <Badge tone={statusTone[check.status]}>{statusText[check.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card title="环境" description="get_env_info()">
            {env.loading ? (
              <p className="text-xs text-faint">读取中…</p>
            ) : (
              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">平台</dt>
                  <dd className="truncate text-text">{env.data?.platform}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">librime</dt>
                  <dd className="font-mono text-text">{env.data?.rime_version}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">用户目录</dt>
                  <dd className="truncate font-mono text-2xs text-text" title={env.data?.rime_user_dir}>
                    {env.data?.rime_user_dir}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="shrink-0 text-faint">共享目录</dt>
                  <dd className="truncate font-mono text-2xs text-muted" title={env.data?.shared_dir}>
                    {env.data?.shared_dir}
                  </dd>
                </div>
              </dl>
            )}
          </Card>

          <Card title="体检项" description="覆盖的检查范围">
            <ol className="space-y-2">
              {diagnosticsSteps.map((step, index) => (
                <li key={step.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line bg-raised font-mono text-2xs text-faint">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-xs text-text">{step.label}</p>
                    <p className="text-2xs text-faint">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Card
        title="部署日志"
        description="最近一次 deploy() · 演示数据"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="danger">1 error</Badge>
            <Badge tone="warn">1 warn</Badge>
            <Button size="sm" variant="ghost">
              复制日志
            </Button>
          </div>
        }
        flush
      >
        <div className="max-h-64 overflow-auto bg-base/60 p-4 font-mono text-2xs leading-5">
          {deployLog.map((line, index) => (
            <div key={`${line.time}-${index}`} className="flex gap-3">
              <span className="shrink-0 tabular text-faint">{line.time}</span>
              <span className={`w-10 shrink-0 uppercase ${levelClass[line.level]}`}>
                {line.level}
              </span>
              <span className={levelClass[line.level]}>{line.message}</span>
            </div>
          ))}
        </div>
      </Card>

      <PlaceholderNote>
        日志为静态示例。后端接入后由 deploy() 返回日志文本，并支持按级别过滤与跳转到对应配置文件。
      </PlaceholderNote>
    </div>
  );
}
