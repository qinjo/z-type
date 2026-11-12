import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import { ipc, type DeployResult, type SchemaInfo } from "@/lib/ipc";
import { applyInputSettingsWithConflict } from "@/lib/guiWrite";
import { SCHEMA_SOURCE_INFO } from "@/lib/schema";
import { errorMessage, toast } from "@/lib/toast";
import { useConflictPrompt } from "@/lib/useConflictPrompt";
import { useIpcQuery } from "@/lib/useIpcQuery";

type SchemaAction = "enable" | "default" | "disable";

interface BusyState {
  action: SchemaAction;
  id: string;
}

/** 选中双拼方案的只读详情：algebra 原文 + 来源提示。 */
function SchemaDetailPanel({ schemaId }: { schemaId: string }) {
  const detail = useIpcQuery(() => ipc.getSchemaDetail(schemaId), [schemaId]);
  const data = detail.data;
  const source = data ? SCHEMA_SOURCE_INFO[data.source] : null;

  return (
    <Card
      title="拼写规则（只读）"
      description={
        data ? (
          <>
            {data.name} · <span className="font-mono text-2xs">{data.id}</span>
          </>
        ) : (
          <span className="font-mono text-2xs">{schemaId}</span>
        )
      }
      actions={
        data ? (
          <Badge tone={source?.tone ?? "neutral"} dot>
            {source?.label ?? data.source}
          </Badge>
        ) : undefined
      }
    >
      {detail.error ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
          读取方案详情失败：{detail.error}
        </p>
      ) : !data ? (
        <p className="text-xs text-faint">读取中…</p>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted">{source?.hint}</p>
          {data.algebra.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-line bg-base/40 px-3 py-2.5 text-xs text-faint">
              该方案没有可读的 speller/algebra 规则
              {data.source === "missing" ? "（方案文件未找到）" : "。"}
            </p>
          ) : (
            <ol className="mt-3 max-h-80 space-y-1 overflow-auto rounded-md border border-line-soft bg-base/50 p-3">
              {data.algebra.map((rule, index) => (
                <li key={`${index}-${rule}`} className="flex gap-2">
                  <span className="w-5 shrink-0 text-right font-mono text-2xs tabular leading-5 text-faint">
                    {index + 1}
                  </span>
                  <code className="break-all font-mono text-2xs leading-5 text-muted">{rule}</code>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-2xs leading-5 text-faint">
            这里只做只读展示：双拼键位与 algebra 强耦合，V1 不提供键位编辑（见下方说明）。
          </p>
        </>
      )}
    </Card>
  );
}

export function Shuangpin() {
  // 方案清单与启用状态分别来自 scan_profile() / get_input_settings()。
  const profile = useIpcQuery(() => ipc.scanProfile());
  const settings = useIpcQuery(() => ipc.getInputSettings());
  /** 写回冲突（未托管键 / 漂移）的统一弹框通道。 */
  const { resolveConflict, conflictDialog } = useConflictPrompt();

  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const schemas = useMemo(
    () => (profile.data?.schemas ?? []).filter((schema) => schema.is_shuangpin),
    [profile.data],
  );

  const enabledIds = useMemo(() => {
    if (settings.data) return settings.data.schema_list;
    return (profile.data?.schemas ?? []).filter((schema) => schema.enabled).map((s) => s.id);
  }, [settings.data, profile.data]);

  const defaultId = enabledIds[0] ?? profile.data?.default_schema ?? "";

  useEffect(() => {
    if (schemas.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((current) => {
      if (current && schemas.some((schema) => schema.id === current)) return current;
      const preferred =
        schemas.find((schema) => schema.id === defaultId) ??
        schemas.find((schema) => schema.enabled) ??
        schemas[0];
      return preferred?.id ?? null;
    });
  }, [schemas, defaultId]);

  function nameOf(id: string): string {
    return (
      profile.data?.schemas.find((schema) => schema.id === id)?.name ?? id
    );
  }

  /** 每次操作都重新读取最新设置，避免覆写其它页面刚保存的 schema_list / page_size。 */
  async function mutateSchemaList(action: SchemaAction, id: string, next: (list: string[]) => string[]) {
    if (busy) return;
    setBusy({ action, id });
    setActionError(null);
    setDeploy(null);
    try {
      const latest = await ipc.getInputSettings();
      const schemaList = next([...latest.schema_list]);
      if (schemaList.length === 0) {
        const message = "schema_list 不能为空：Rime 至少需要一个启用方案。";
        setActionError(message);
        toast("提交前校验未通过", "danger");
        return;
      }
      // 冲突时由 ConflictDialog 决定「保留我的」还是「用切韵的值覆盖」（adopt 重放）。
      const outcome = await applyInputSettingsWithConflict(
        { ...latest, schema_list: schemaList },
        resolveConflict,
      );
      if (outcome.status === "kept") return;
      const written = outcome.result;
      profile.reload();
      settings.reload();
      if (!autoDeploy) {
        toast(
          written.written_files.length > 0
            ? `已保存 · 写入 ${written.written_files.join("、")}`
            : "已保存（无文件变更）",
          "ok",
        );
        return;
      }
      const result = await ipc.applyAndDeploy();
      setDeploy(result);
      setLogOpen(true);
      toast(
        result.ok ? "已保存并部署" : "写入成功，但部署失败，请查看日志",
        result.ok ? "ok" : "danger",
      );
    } catch (error) {
      setActionError(errorMessage(error));
      toast("写入失败，后端已中止写入", "danger");
    } finally {
      setBusy(null);
    }
  }

  const actionsDisabled = busy !== null;

  if (!profile.data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="双拼"
          description="切换双拼方案、查看拼写规则。V1 只读展示，不提供键位图与键位编辑。"
          actions={
            profile.error ? (
              <Button size="sm" onClick={profile.reload}>
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="读取方案清单" description="scan_profile()">
          {profile.error ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
              读取失败：{profile.error}
            </p>
          ) : (
            <p className="text-xs text-faint">读取中…</p>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="双拼"
        description="切换双拼方案、查看拼写规则。操作只改 default.custom.yaml 的 schema_list；是否生效取决于后续部署。"
        actions={
          <Badge tone="accent">
            当前默认：{defaultId ? nameOf(defaultId) : "—"}
          </Badge>
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
            <p className="text-xs font-medium text-danger">写入未完成</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs leading-5 text-danger/90">
              {actionError}
            </p>
          </div>
        </div>
      )}

      {profile.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-warn/35 bg-warn/10 px-3 py-2.5 text-xs text-warn"
        >
          <span className="min-w-0 break-words">读取方案清单失败：{profile.error}</span>
          <Button size="sm" variant="ghost" onClick={profile.reload}>
            重试
          </Button>
        </div>
      )}

      <div className="grid grid-cols-[1.1fr_1fr] gap-4">
        <Card
          title="双拼方案"
          description={`来自 scan_profile() 的 is_shuangpin · 共 ${schemas.length} 个`}
          actions={
            <label className="flex items-center gap-2 text-2xs text-muted">
              应用后自动部署
              <Switch
                checked={autoDeploy}
                onChange={setAutoDeploy}
                label="应用后自动部署"
                disabled={actionsDisabled}
              />
            </label>
          }
        >
          {schemas.length === 0 ? (
            <p className="rounded-md border border-dashed border-line bg-base/40 px-3 py-6 text-center text-xs text-faint">
              没有检测到双拼方案。双拼方案通过方案 id（double_pinyin*）或名称中的「双拼」识别。
            </p>
          ) : (
            <div className="space-y-2">
              {schemas.map((schema: SchemaInfo) => {
                const isEnabled = enabledIds.includes(schema.id);
                const isDefault = schema.id === defaultId;
                const isSelected = schema.id === selected;
                const rowBusy = busy?.id === schema.id ? busy.action : null;
                return (
                  <div
                    key={schema.id}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      isSelected
                        ? "border-accent/60 bg-accent/5"
                        : "border-line bg-base/30 hover:bg-raised/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setSelected(schema.id)}
                        aria-pressed={isSelected}
                        className="min-w-0 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-medium text-text">{schema.name}</span>
                          {isDefault && <Badge tone="accent">默认</Badge>}
                          <Badge tone={isEnabled ? "ok" : "neutral"} dot>
                            {isEnabled ? "已启用" : "未启用"}
                          </Badge>
                          {isSelected && <Badge tone="neutral">查看中</Badge>}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-2xs text-faint">
                          {schema.id}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            mutateSchemaList("enable", schema.id, (list) =>
                              list.includes(schema.id) ? list : [...list, schema.id],
                            )
                          }
                          disabled={actionsDisabled || isEnabled}
                          title={isEnabled ? "该方案已启用" : "追加到 schema_list 末尾"}
                        >
                          {rowBusy === "enable" ? "启用中…" : "启用"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            mutateSchemaList("default", schema.id, (list) => [
                              schema.id,
                              ...list.filter((value) => value !== schema.id),
                            ])
                          }
                          disabled={actionsDisabled || isDefault}
                          title={
                            isDefault
                              ? "该方案已经是默认方案"
                              : "启用（若需要）并移到 schema_list 首位"
                          }
                        >
                          {rowBusy === "default" ? "设置中…" : "设为默认"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            mutateSchemaList("disable", schema.id, (list) =>
                              list.filter((value) => value !== schema.id),
                            )
                          }
                          disabled={actionsDisabled || !isEnabled || isDefault}
                          title={
                            isDefault
                              ? "默认方案不允许停用：请先把其它方案设为默认"
                              : !isEnabled
                                ? "该方案未启用"
                                : "从 schema_list 中移除"
                          }
                        >
                          {rowBusy === "disable" ? "停用中…" : "停用"}
                        </Button>
                      </div>
                    </div>
                    {isDefault && (
                      <p className="mt-2 text-2xs leading-5 text-warn">
                        默认方案不允许停用：请先把另一个方案设为默认，再停用它。
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-2xs leading-5 text-faint">
            识别规则由后端给出（id 以 <span className="font-mono">double_pinyin</span> 开头或名称含「双拼」），
            前端不自行猜测。设为默认会把方案移到 schema_list 首位，未启用时先追加再置顶。
          </p>
        </Card>

        <div className="space-y-4">
          {selected ? (
            <SchemaDetailPanel key={selected} schemaId={selected} />
          ) : (
            <Card title="拼写规则（只读）" description="选择一个双拼方案查看详情">
              <p className="rounded-md border border-dashed border-line bg-base/40 px-3 py-6 text-center text-xs text-faint">
                暂无选中方案。
              </p>
            </Card>
          )}

          <Card
            title="键位图暂不提供"
            description="V1 只读展示拼写规则 + 方案切换"
            actions={<Badge tone="warn">V1</Badge>}
          >
            <p className="text-xs leading-5 text-muted">
              双拼键位与 <span className="font-mono text-2xs text-text">speller/algebra</span>{" "}
              强耦合，画错比不画更危险，因此本版本不提供键位图与键位录制。
            </p>
            <p className="mt-2 text-2xs leading-5 text-faint">
              现阶段请通过「设为默认 / 启用」切换方案，并用右侧的 algebra 原文核对拼写规则。
              后续版本会在能安全 patch 方案 algebra 之后再加上键位编辑。
            </p>
          </Card>
        </div>
      </div>

      {deploy && (
        <Card
          title="部署日志"
          description={`apply_and_deploy() · ${deploy.ok ? "部署成功" : "部署失败"}`}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={deploy.ok ? "ok" : "danger"} dot>
                {deploy.ok ? "ok" : "failed"}
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => setLogOpen((open) => !open)}>
                {logOpen ? "收起日志" : "展开日志"}
              </Button>
            </div>
          }
        >
          <p className={cn("text-xs leading-5", deploy.ok ? "text-muted" : "text-danger")}>
            {deploy.ok
              ? "方案切换已写入 default.custom.yaml，并已触发外壳重载。"
              : "部署未成功。schema_list 已写入，可在「诊断与日志」查看详情或稍后手动重新部署。"}
          </p>
          {logOpen && (
            <pre
              className={cn(
                "mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-2xs leading-5",
                deploy.ok
                  ? "border-line bg-base/60 text-muted"
                  : "border-danger/30 bg-danger/5 text-danger",
              )}
            >
              {deploy.log || "（部署器未返回日志）"}
            </pre>
          )}
        </Card>
      )}

      {conflictDialog}
    </div>
  );
}
