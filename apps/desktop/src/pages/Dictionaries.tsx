import { useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import {
  ipc,
  type DictFile,
  type UserDb,
} from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type Busy = "snapshot" | "restore" | "reveal" | null;

const SCOPE_LABEL: Record<DictFile["scope"], string> = {
  user: "用户",
  shared: "共享",
};

const SCOPE_HINT: Record<DictFile["scope"], string> = {
  user: "用户目录（可写）",
  shared: "共享目录（随方案安装）",
};

export function Dictionaries() {
  const inventory = useIpcQuery(() => ipc.getDictInventory());
  const snapshots = useIpcQuery(() => ipc.listSnapshots());
  const env = useIpcQuery(() => ipc.getEnvInfo());

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** 待二次确认恢复的快照 id；null 表示没有展开确认。 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const dicts = inventory.data?.dicts ?? [];
  const userdbs = inventory.data?.userdbs ?? [];
  const syncDir = inventory.data?.sync_dir ?? null;
  const userDbTotal = useMemo(
    () => userdbs.reduce((sum, db) => sum + db.size_bytes, 0),
    [userdbs],
  );

  async function createSnapshot() {
    if (busy) return;
    setBusy("snapshot");
    setActionError(null);
    try {
      const result = await ipc.createSnapshot("手动快照");
      toast(`快照已创建：${result.id}`, "ok");
      snapshots.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("创建快照失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function restore(snapshotId: string) {
    if (busy) return;
    setBusy("restore");
    setActionError(null);
    try {
      const result = await ipc.restoreSnapshot(snapshotId);
      const backup = result.backup_id
        ? `，恢复前已自动备份 ${result.backup_id}`
        : "";
      // 恢复后后端会把托管键的值重新登记（否则下一次结构化写入会被误判为漂移）。
      toast(
        `已恢复 ${result.restored_files} 个文件（托管键已重新登记 ${result.refreshed_keys} 个）${backup}`,
        "ok",
      );
      setConfirmingId(null);
      snapshots.reload();
      inventory.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("恢复快照失败，当前配置未被覆盖", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function revealUserDir() {
    const path = env.data?.rime_user_dir;
    if (!path || busy) return;
    setBusy("reveal");
    setActionError(null);
    try {
      await ipc.revealPath(path);
      toast("已在文件管理器中显示用户目录", "ok");
    } catch (error) {
      setActionError(errorMessage(error));
      toast("无法打开文件管理器", "danger");
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      title="词典"
      description="盘点用户目录与共享目录里的词典、用户词库与同步配置。本页只读，不会修改任何文件。"
      actions={
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={revealUserDir}
            disabled={busy !== null || !env.data}
            title={
              env.data
                ? `在文件管理器中显示 ${env.data.rime_user_dir}`
                : "读取用户目录后才能显示"
            }
          >
            <Icon name="folder" size={14} />
            在 Finder 中显示
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={createSnapshot}
            disabled={busy !== null}
          >
            <Icon name="snapshot" size={14} />
            {busy === "snapshot" ? "创建中…" : "新建快照"}
          </Button>
        </>
      }
    />
  );

  if (!inventory.data) {
    const error = inventory.error;
    return (
      <div className="space-y-5">
        {header}
        <Card title="词典盘点" description="get_dict_inventory()">
          {error ? (
            <div className="flex items-start justify-between gap-4">
              <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
                读取词典盘点失败：{error}
              </p>
              <Button size="sm" variant="ghost" onClick={inventory.reload}>
                重试
              </Button>
            </div>
          ) : (
            <p className="text-xs text-faint">读取中…</p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}

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

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">词典数</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-text tabular">
            {dicts.length}
          </p>
          <p className="mt-0.5 text-2xs text-faint">用户目录 + 共享目录</p>
        </Card>
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">用户词库</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-text tabular">
            {userdbs.length}
            <span className="ml-1.5 text-xs font-normal text-muted">
              共 {formatBytes(userDbTotal)}
            </span>
          </p>
          <p className="mt-0.5 text-2xs text-faint">LevelDB 目录 · *.userdb</p>
        </Card>
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">编译产物</p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-text tabular">
            {inventory.data.build_artifacts}
          </p>
          <p className="mt-0.5 text-2xs text-faint">build/ · .bin + .schema.yaml</p>
        </Card>
        <Card>
          <p className="text-2xs uppercase tracking-wide text-faint">同步目录</p>
          <p
            className={cn(
              "mt-1 truncate text-[13px] font-semibold tracking-tight",
              syncDir ? "text-text" : "text-warn",
            )}
            title={syncDir ?? undefined}
          >
            {syncDir ? "已配置" : "未配置"}
          </p>
          <p className="mt-0.5 truncate text-2xs text-faint" title={syncDir ?? undefined}>
            {syncDir ?? "同步不会生效"}
          </p>
        </Card>
      </div>

      <Card
        title="词典文件"
        description={`get_dict_inventory() · 共 ${dicts.length} 个 *.dict.yaml`}
        flush
      >
        {dicts.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-warn">没有发现任何词典文件。</p>
            <p className="mx-auto mt-1 max-w-md text-2xs leading-5 text-faint">
              可能是 plum 未安装方案，或当前 Rime 用户目录里还没有方案自带/导入的
              *.dict.yaml。先安装方案（如 rime-ice）并部署一次，再回到本页刷新。
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">文件名</th>
                <th className="px-4 py-2.5 font-medium">来源</th>
                <th className="w-28 px-4 py-2.5 text-right font-medium">大小</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {dicts.map((dict) => (
                <tr key={`${dict.scope}-${dict.name}`} className="hover:bg-raised/40">
                  <td className="px-4 py-3">
                    <span className="font-mono text-2xs text-text">{dict.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={dict.scope === "user" ? "accent" : "neutral"}>
                      {dict.scope}
                    </Badge>
                    <span className="ml-2 text-2xs text-faint">
                      {SCOPE_LABEL[dict.scope]} · {SCOPE_HINT[dict.scope]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-2xs tabular text-muted">
                    {formatBytes(dict.size_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="用户词库"
        description={`get_dict_inventory() · 共 ${userdbs.length} 个`}
        flush
      >
        {userdbs.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">
            还没有用户词库：输入一段时间后 librime 才会生成 *.userdb。
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">格式</th>
                <th className="w-28 px-4 py-2.5 text-right font-medium">大小</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {userdbs.map((db: UserDb) => (
                <tr key={db.name} className="hover:bg-raised/40">
                  <td className="px-4 py-3 font-mono text-2xs text-text">{db.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={db.legacy_text ? "warn" : "accent"}>
                      {db.legacy_text ? "legacy 文本词库" : "LevelDB 目录"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-2xs tabular text-muted">
                    {formatBytes(db.size_bytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex items-start gap-2.5 border-t border-line-soft bg-warn/5 px-4 py-3">
          <span className="mt-0.5 shrink-0 text-warn">
            <Icon name="warning" size={15} />
          </span>
          <p className="text-xs leading-5 text-warn/90">
            用户词库是 LevelDB 格式，V1 只盘点不修改；删词/导入导出需要内嵌 librime 的
            user_dict API（V2）。
          </p>
        </div>
      </Card>

      <Card
        title="同步"
        description="installation.yaml · sync_dir"
        actions={
          <Badge tone={syncDir ? "ok" : "warn"} dot>
            {syncDir ? "已配置" : "未配置"}
          </Badge>
        }
      >
        <div className="rounded border border-line-soft bg-base/40 px-3 py-2">
          <div className="flex items-center justify-between gap-4">
            <span className="shrink-0 text-xs text-muted">同步目录</span>
            <span
              className={cn(
                "min-w-0 truncate text-right font-mono text-2xs",
                syncDir ? "text-text" : "text-warn",
              )}
              title={syncDir ?? undefined}
            >
              {syncDir ?? "未配置（同步不会生效）"}
            </span>
          </div>
        </div>
        <p className="mt-2 text-2xs leading-5 text-faint">
          同步由 librime 的 sync_user_data() 执行，需要在 installation.yaml 里填写
          sync_dir；本页只展示配置，不触发同步。
        </p>
      </Card>

      <Card
        title="快照"
        description={`list_snapshots() · 共 ${snapshots.data?.length ?? 0} 个；恢复前会自动再备份当前状态`}
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              snapshots.reload();
              inventory.reload();
            }}
            disabled={snapshots.loading}
          >
            <Icon name="search" size={14} />
            刷新
          </Button>
        }
        flush
      >
        {snapshots.error ? (
          <div className="flex items-center justify-between gap-4 px-4 py-4">
            <p className="whitespace-pre-wrap text-xs text-danger">
              读取快照失败：{snapshots.error}
            </p>
            <Button size="sm" variant="ghost" onClick={snapshots.reload}>
              重试
            </Button>
          </div>
        ) : snapshots.loading && !snapshots.data ? (
          <p className="px-4 py-6 text-center text-xs text-faint">读取中…</p>
        ) : (snapshots.data?.length ?? 0) === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">
            还没有快照。点右上角「新建快照」记录当前配置。
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">快照</th>
                <th className="px-4 py-2.5 font-medium">时间</th>
                <th className="px-4 py-2.5 font-medium">备注</th>
                <th className="w-52 px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {(snapshots.data ?? []).map((snapshot) => {
                const confirming = confirmingId === snapshot.id;
                return (
                  <tr key={snapshot.id} className="hover:bg-raised/40">
                    <td className="px-4 py-3 font-mono text-2xs text-text">
                      {snapshot.id}
                    </td>
                    <td className="px-4 py-3 font-mono text-2xs tabular text-muted">
                      {snapshot.created_at}
                    </td>
                    <td className="px-4 py-3 text-faint">{snapshot.note || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {confirming ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-2xs text-warn">覆盖当前配置？</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmingId(null)}
                            disabled={busy !== null}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => restore(snapshot.id)}
                            disabled={busy !== null}
                          >
                            {busy === "restore" ? "恢复中…" : "确认恢复"}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActionError(null);
                            setConfirmingId(snapshot.id);
                          }}
                          disabled={busy !== null}
                        >
                          恢复
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
