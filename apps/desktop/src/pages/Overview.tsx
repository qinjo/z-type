import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { TakeoverBanner } from "@/components/TakeoverBanner";
import { TypingLab } from "@/components/TypingLab";
import { healthChecks } from "@/lib/demo-data";
import { ipc } from "@/lib/ipc";
import { useIpcQuery } from "@/lib/useIpcQuery";

const statusTone = {
  ok: "ok",
  warn: "warn",
  fail: "danger",
} as const;

const statusLabel = {
  ok: "通过",
  warn: "警告",
  fail: "异常",
} as const;

export function Overview() {
  const env = useIpcQuery(() => ipc.getEnvInfo());
  const profile = useIpcQuery(() => ipc.scanProfile());
  const snapshots = useIpcQuery(() => ipc.listSnapshots());

  const enabledCount = profile.data?.schemas.filter((schema) => schema.enabled).length ?? 0;
  const failed = healthChecks.filter((check) => check.status !== "ok").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="概览"
        description="一眼看清当前 Rime 配置的状态：默认方案、目录位置、体检结果与最近快照。"
        actions={
          <Button size="sm" onClick={() => {
            env.reload();
            profile.reload();
            snapshots.reload();
          }}>
            <Icon name="search" size={14} />
            重新扫描
          </Button>
        }
      />

      <TakeoverBanner onTakenOver={() => snapshots.reload()} />

      {/* 试打字放在概览：它是默认落地页、也是「先玩一下」的最低门槛入口；
          诊断页已经承载体检与日志这类只读判断，试打字不是诊断动作。 */}
      <TypingLab />

      <div className="grid grid-cols-3 gap-4">
        <Card title="当前方案" description="来自 scan_profile()" actions={<Badge tone="accent">默认</Badge>}>
          <p className="text-xl font-semibold tracking-tight text-text">
            {profile.loading ? "读取中…" : (profile.data?.schemas.find((s) => s.id === profile.data?.default_schema)?.name ?? "未识别")}
          </p>
          <p className="mt-1 font-mono text-xs text-faint">
            {profile.loading ? "—" : (profile.data?.default_schema ?? "—")}
          </p>
          <div className="mt-4 flex items-center gap-4 border-t border-line-soft pt-3 text-xs text-muted">
            <span>
              已启用 <span className="tabular text-text">{enabledCount}</span> /{" "}
              {profile.data?.schemas.length ?? 0} 个方案
            </span>
            <span className="text-line">·</span>
            <span>
              <span className="tabular text-text">{profile.data?.themes.length ?? 0}</span> 套主题
            </span>
          </div>
        </Card>

        <Card title="目录与运行时" description="来自 get_env_info()">
          {env.loading ? (
            <p className="text-xs text-faint">读取中…</p>
          ) : env.error ? (
            <p className="text-xs text-danger">{env.error}</p>
          ) : (
            <dl className="space-y-2.5 text-xs">
              <div>
                <dt className="text-faint">用户目录</dt>
                <dd className="mt-0.5 truncate font-mono text-text" title={env.data?.rime_user_dir}>
                  {env.data?.rime_user_dir}
                </dd>
              </div>
              <div>
                <dt className="text-faint">共享目录</dt>
                <dd className="mt-0.5 truncate font-mono text-muted" title={env.data?.shared_dir}>
                  {env.data?.shared_dir}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-line-soft pt-2.5">
                <dt className="text-faint">平台</dt>
                <dd className="text-text">{env.data?.platform}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-faint">librime</dt>
                <dd className="font-mono text-text">{env.data?.rime_version}</dd>
              </div>
            </dl>
          )}
        </Card>

        <Card
          title="体检状态"
          description={`${healthChecks.length - failed} 项通过 · ${failed} 项需关注`}
          actions={
            <Badge tone={failed > 0 ? "warn" : "ok"} dot>
              {failed > 0 ? "需处理" : "健康"}
            </Badge>
          }
        >
          <ul className="space-y-2.5">
            {healthChecks.slice(0, 4).map((check) => (
              <li key={check.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs text-text">{check.label}</p>
                  <p className="truncate text-2xs text-faint">{check.detail}</p>
                </div>
                <Badge tone={statusTone[check.status]}>{statusLabel[check.status]}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <Card
          title="最近快照"
          description="每次写入 custom.yaml 前的自动备份"
          actions={
            <Button size="sm" variant="ghost">
              <Icon name="plus" size={14} />
              新建快照
            </Button>
          }
          flush
        >
          <ul className="divide-y divide-line-soft">
            {snapshots.loading && <li className="px-4 py-6 text-center text-xs text-faint">读取中…</li>}
            {snapshots.data?.map((snapshot) => (
              <li key={snapshot.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-raised text-faint">
                  <Icon name="snapshot" size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-text">{snapshot.note}</p>
                  <p className="font-mono text-2xs text-faint">
                    {snapshot.id} · {snapshot.created_at}
                  </p>
                </div>
                <Button size="sm" variant="ghost">
                  恢复
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="快捷操作" description="常用入口">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="justify-start">
              <Icon name="deploy" size={15} />
              部署配置
            </Button>
            <Button variant="secondary" className="justify-start">
              <Icon name="folder" size={15} />
              打开目录
            </Button>
            <Button variant="secondary" className="justify-start">
              <Icon name="diagnostics" size={15} />
              运行体检
            </Button>
            <Button variant="secondary" className="justify-start">
              <Icon name="external" size={15} />
              查看日志
            </Button>
          </div>
          <PlaceholderNote className="mt-4">
            数据来自 src/lib/ipc.ts 的类型化调用。检测到
            <code className="mx-1 rounded bg-raised px-1 font-mono text-2xs">__TAURI_INTERNALS__</code>
            时走真实 Tauri 命令，浏览器中则自动降级为 mock 数据。
          </PlaceholderNote>
        </Card>
      </div>
    </div>
  );
}
