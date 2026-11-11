import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { NumberInput } from "@/components/NumberInput";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import {
  ipc,
  type DeployResult,
  type InputSettings,
  type SchemaInfo,
  type WriteResult,
} from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type Busy = "save" | "deploy" | null;

const PAGE_SIZE_PRESETS = [3, 5, 7, 9, 10] as const;

/** 草稿相对后端当前值是否有改动（顺序、启用集合、候选数量）。 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function Schemas() {
  // 方案清单（含未启用）来自 scan_profile()，启用顺序来自 get_input_settings()。
  const profile = useIpcQuery(() => ipc.scanProfile());
  const settings = useIpcQuery(() => ipc.getInputSettings());

  const [schemaList, setSchemaList] = useState<string[] | null>(null);
  const [pageSize, setPageSize] = useState(7);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [writtenFiles, setWrittenFiles] = useState<string[]>([]);
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // 首屏与每次保存后重新拉取时，用后端返回值覆盖草稿。
  useEffect(() => {
    if (!settings.data) return;
    setSchemaList([...settings.data.schema_list]);
    setPageSize(settings.data.page_size);
  }, [settings.data]);

  const original = settings.data;
  const dirty = useMemo(() => {
    if (!original || !schemaList) return false;
    return !sameList(schemaList, original.schema_list) || pageSize !== original.page_size;
  }, [original, schemaList, pageSize]);

  const schemaById = useMemo(
    () => new Map((profile.data?.schemas ?? []).map((schema) => [schema.id, schema])),
    [profile.data],
  );
  const available = profile.data?.schemas ?? [];
  const orderedIds = schemaList ?? [];
  const disabledSchemas = available.filter((schema) => !orderedIds.includes(schema.id));

  function nameOf(id: string): string {
    return schemaById.get(id)?.name ?? id;
  }

  function toggleSchema(id: string, enabled: boolean) {
    setActionError(null);
    setSchemaList((list) => {
      if (!list) return list;
      if (enabled) return list.includes(id) ? list : [...list, id];
      return list.filter((value) => value !== id);
    });
  }

  /** 设为默认 = 启用（若需要）并移到 schema_list 首位。 */
  function makeDefault(id: string) {
    setActionError(null);
    setSchemaList((list) => [id, ...(list ?? []).filter((value) => value !== id)]);
  }

  function resetDraft() {
    if (!original) return;
    setSchemaList([...original.schema_list]);
    setPageSize(original.page_size);
    setActionError(null);
  }

  function buildSettings(): InputSettings | null {
    if (!schemaList || !original) return null;
    if (schemaList.length === 0) {
      const message =
        "请至少启用一个方案：schema_list 不能为空，否则 Rime 无法确定默认方案。";
      setActionError(message);
      toast("提交前校验未通过", "danger");
      return null;
    }
    return {
      ...original,
      schema_list: schemaList,
      page_size: pageSize,
    };
  }

  /** 校验并写入 default.custom.yaml；失败时把后端中文原文交给页面展示。 */
  async function applyDraft(): Promise<WriteResult | null> {
    const payload = buildSettings();
    if (!payload) return null;
    setActionError(null);
    const written = await ipc.applyInputSettings(payload);
    setWrittenFiles(written.written_files);
    return written;
  }

  async function save() {
    if (busy || !schemaList) return;
    setBusy("save");
    try {
      const written = await applyDraft();
      if (!written) return;
      toast(
        written.written_files.length > 0
          ? `已保存 · 写入 ${written.written_files.join("、")}`
          : "已保存（无文件变更）",
        "ok",
      );
      // 让 enable/默认方案的展示与磁盘上的 default.custom.yaml 保持同步。
      profile.reload();
      settings.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存失败，后端已中止写入", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndDeploy() {
    if (busy || !schemaList) return;
    setBusy("deploy");
    setDeploy(null);
    try {
      const written = await applyDraft();
      if (!written) return;
      profile.reload();
      settings.reload();
      const result = await ipc.applyAndDeploy();
      setDeploy(result);
      setLogOpen(true);
      toast(
        result.ok ? "已保存并部署" : "写入成功，但部署失败，请查看日志",
        result.ok ? "ok" : "danger",
      );
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存并部署失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (schemaList === null) {
    const error = settings.error ?? profile.error;
    return (
      <div className="space-y-5">
        <PageHeader
          title="方案与启用"
          description="管理 schema_list、默认方案与每个方案的启用状态；变更会写回 default.custom.yaml，重建后生效。"
          actions={
            error ? (
              <Button
                size="sm"
                onClick={() => {
                  settings.reload();
                  profile.reload();
                }}
              >
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="读取方案设置" description="scan_profile() + get_input_settings()">
          {error ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
              读取失败：{error}
            </p>
          ) : (
            <p className="text-xs text-faint">读取中…</p>
          )}
        </Card>
      </div>
    );
  }

  const enabledNames = schemaList.map((id) => nameOf(id)).join("、");

  return (
    <div className="space-y-5">
      <PageHeader
        title="方案与启用"
        description="管理 schema_list、默认方案与每个方案的启用状态；变更会写回 default.custom.yaml，重建后生效。"
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={resetDraft}
              disabled={!dirty || busy !== null}
            >
              重置
            </Button>
            <Button size="sm" variant="secondary" onClick={save} disabled={busy !== null}>
              <Icon name="check" size={14} />
              {busy === "save" ? "保存中…" : "保存"}
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

      <Card
        title="已启用方案"
        description={
          <>
            共 {schemaList.length} 个 · 顺序即生效顺序，
            <span className="text-accent">第一个是默认方案</span>
          </>
        }
        actions={
          <Badge tone={dirty ? "warn" : "neutral"} dot>
            {dirty ? "未保存" : "与磁盘一致"}
          </Badge>
        }
        flush
      >
        {schemaList.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-warn">
            尚未启用任何方案，请从下方列表启用，或直接设置默认方案。
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="w-16 px-4 py-2.5 font-medium">顺序</th>
                <th className="px-4 py-2.5 font-medium">方案</th>
                <th className="px-4 py-2.5 font-medium">标识</th>
                <th className="px-4 py-2.5 font-medium">默认</th>
                <th className="w-20 px-4 py-2.5 text-right font-medium">启用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {schemaList.map((id, index) => (
                <tr key={id} className="group hover:bg-raised/40">
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded border px-1 font-mono text-2xs tabular",
                        index === 0
                          ? "border-accent/50 bg-accent/10 text-accent"
                          : "border-line bg-raised text-muted",
                      )}
                      title={`生效顺序第 ${index + 1} 位`}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{nameOf(id)}</span>
                      {index === 0 && <Badge tone="accent">默认</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-faint">{id}</td>
                  <td className="px-4 py-3">
                    {index === 0 ? (
                      <span className="text-2xs text-faint">当前默认</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => makeDefault(id)}
                        disabled={busy !== null}
                      >
                        设为默认
                      </Button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Switch
                      checked
                      onChange={(next) => toggleSchema(id, next)}
                      label={`启用 ${nameOf(id)}`}
                      disabled={busy !== null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="未启用方案"
        description={`来自 scan_profile() · 共 ${disabledSchemas.length} 个`}
        flush
      >
        {disabledSchemas.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">
            所有扫描到的方案都已启用。
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">方案</th>
                <th className="px-4 py-2.5 font-medium">标识</th>
                <th className="px-4 py-2.5 font-medium">操作</th>
                <th className="w-20 px-4 py-2.5 text-right font-medium">启用</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {disabledSchemas.map((schema: SchemaInfo) => (
                <tr key={schema.id} className="hover:bg-raised/40">
                  <td className="px-4 py-3 font-medium text-muted">{schema.name}</td>
                  <td className="px-4 py-3 font-mono text-faint">{schema.id}</td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => makeDefault(schema.id)}
                      disabled={busy !== null}
                      title="启用该方案并移到首位，使其成为默认方案"
                    >
                      设为默认
                    </Button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Switch
                      checked={false}
                      onChange={(next) => toggleSchema(schema.id, next)}
                      label={`启用 ${schema.name}`}
                      disabled={busy !== null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="候选数量" description="写入 menu/page_size，影响候选窗每页显示的行数">
          <div className="flex items-center gap-4">
            <NumberInput
              ariaLabel="候选数量"
              value={pageSize}
              min={3}
              max={10}
              suffix="行"
              onChange={setPageSize}
              disabled={busy !== null}
            />
            <div className="flex gap-1">
              {PAGE_SIZE_PRESETS.map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-pressed={pageSize === size}
                  onClick={() => setPageSize(size)}
                  disabled={busy !== null}
                  className={cn(
                    "h-7 w-7 rounded border font-mono text-2xs tabular transition-colors disabled:opacity-45",
                    pageSize === size
                      ? "border-accent/60 bg-accent/15 text-accent-hover"
                      : "border-line bg-raised/60 text-muted hover:bg-raised hover:text-text",
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
            <span className="text-2xs text-faint">范围 3–10，默认 7</span>
          </div>
        </Card>

        <Card
          title="写入与刷新"
          description="保存只写 default.custom.yaml；保存并部署会再触发一次重建"
          actions={<Badge tone="accent">default.custom.yaml</Badge>}
        >
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span className="font-mono text-2xs">patch: schema_list</span>
              <span className="text-2xs text-faint">{schemaList.length} 个方案</span>
            </li>
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span className="font-mono text-2xs">patch: menu/page_size</span>
              <span className="text-2xs tabular text-faint">{pageSize}</span>
            </li>
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span className="font-mono text-2xs">patch: key_binder/bindings</span>
              <span className="text-2xs text-faint">由「按键」页管理</span>
            </li>
          </ul>
          <p className="mt-3 text-2xs leading-5 text-faint">
            {enabledNames ? (
              <>
                当前草稿默认方案：
                <span className="text-accent">
                  {schemaList[0] ? nameOf(schemaList[0]) : "—"}
                </span>
                {writtenFiles.length > 0 && (
                  <> · 上次写入 {writtenFiles.join("、")}</>
                )}
              </>
            ) : (
              "尚未启用方案。"
            )}
          </p>
        </Card>
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
              ? `方案设置已写入${writtenFiles.length > 0 ? ` ${writtenFiles.join("、")}` : ""}，并已触发外壳重载。`
              : "部署未成功。配置本身已写入，可在「诊断与日志」查看详情或稍后手动重新部署。"}
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
    </div>
  );
}
