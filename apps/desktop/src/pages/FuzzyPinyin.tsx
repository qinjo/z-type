import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { Switch } from "@/components/Switch";
import { cn } from "@/lib/cn";
import { ipc, type DeployResult, type WriteResult } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type Busy = "save" | "deploy" | null;

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function FuzzyPinyin() {
  const settings = useIpcQuery(() => ipc.getFuzzySettings());

  // 勾选状态与后端返回的 enabled 对齐；保存后再重拉，用后端值覆盖草稿。
  const [selected, setSelected] = useState<string[] | null>(null);
  /** 本次刚写入磁盘的选择；用于识别「已保存但 build 产物未重新编译」的窗口。 */
  const [savedGroups, setSavedGroups] = useState<string[] | null>(null);
  const [staleBuild, setStaleBuild] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [writtenFiles, setWrittenFiles] = useState<string[]>([]);
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const data = settings.data;

  const enabledFromServer = useMemo(
    () => (data ? data.groups.filter((group) => group.enabled).map((group) => group.id) : []),
    [data],
  );

  useEffect(() => {
    if (!data) return;
    // get_fuzzy_settings 读的是 build/<id>.schema.yaml。刚保存、还没部署时 build 仍是旧的，
    // 此时保留用户刚保存的勾选并提示需要部署，而不是把它们「弹回」旧状态。
    if (savedGroups && !sameIds(savedGroups, enabledFromServer)) {
      setStaleBuild(true);
      setSelected(savedGroups);
      return;
    }
    setStaleBuild(false);
    setSelected(enabledFromServer);
  }, [data, enabledFromServer, savedGroups]);

  /** 当前用于比较「是否有未保存改动」的基线：保存过但未部署时以刚写入的选择为准。 */
  const baseline = staleBuild && savedGroups ? savedGroups : enabledFromServer;

  const selectedSet = useMemo(() => new Set(selected ?? []), [selected]);
  const orderedSelected = useMemo(
    () => (data ? data.groups.filter((group) => selectedSet.has(group.id)) : []),
    [data, selectedSet],
  );

  const dirty = useMemo(() => {
    if (selected === null) return false;
    return !sameIds(
      orderedSelected.map((group) => group.id),
      baseline,
    );
  }, [orderedSelected, baseline, selected]);

  const generatedRules = useMemo(
    () => orderedSelected.flatMap((group) => group.rules),
    [orderedSelected],
  );

  function toggle(groupId: string, checked: boolean) {
    setActionError(null);
    setSelected((current) => {
      const base = current ?? [];
      const next = checked
        ? base.includes(groupId)
          ? base
          : [...base, groupId]
        : base.filter((id) => id !== groupId);
      if (!data) return next;
      // 始终保持后端定义的组顺序，生成的规则顺序稳定、diff 可读。
      return data.groups
        .map((group) => group.id)
        .filter((id) => next.includes(id));
    });
  }

  function resetDraft() {
    if (!data) return;
    setSavedGroups(null);
    setStaleBuild(false);
    setSelected(enabledFromServer);
    setActionError(null);
  }

  /** 写入 `<schema>.custom.yaml`；失败时把后端中文原文原样交给页面展示。 */
  async function applyDraft(): Promise<WriteResult | null> {
    if (!data || selected === null) return null;
    setActionError(null);
    const ids = orderedSelected.map((group) => group.id);
    const written = await ipc.applyFuzzySettings(data.schema_id, ids);
    setSavedGroups(ids);
    setWrittenFiles(written.written_files);
    return written;
  }

  async function save() {
    if (busy || !data || selected === null) return;
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
      settings.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存失败，后端已中止写入", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndDeploy() {
    if (busy || !data || selected === null) return;
    setBusy("deploy");
    setDeploy(null);
    try {
      const written = await applyDraft();
      if (!written) return;
      settings.reload();
      const result = await ipc.applyAndDeploy();
      setDeploy(result);
      setLogOpen(true);
      toast(
        result.ok ? "已保存并部署" : "写入成功，但部署失败，请查看日志",
        result.ok ? "ok" : "danger",
      );
      // 部署成功后 build 产物才是新的；再拉一次让规则计数与勾选与磁盘一致。
      if (result.ok) settings.reload();
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存并部署失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  if (!data || selected === null) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="模糊音"
          description="为常见的平翘舌、前后鼻音、n/l 混淆建立容错。模糊音会显著增加重码，建议按需开启。"
          actions={
            settings.error ? (
              <Button size="sm" onClick={settings.reload}>
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="读取模糊音设置" description="get_fuzzy_settings()">
          {settings.error ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
              读取失败：{settings.error}
            </p>
          ) : (
            <p className="text-xs text-faint">读取中…</p>
          )}
        </Card>
      </div>
    );
  }

  const previewLines = [
    `# 写入 ${data.schema_id}.custom.yaml`,
    "# 后端实际写入 = 方案原有 algebra（先剥离旧模糊音规则）+ 下列规则（去重）",
    "patch:",
    '  "speller/algebra":',
  ];
  if (generatedRules.length === 0) {
    previewLines.push(
      "    # 未选择任何模糊音组：保存会剥离已有模糊音规则，恢复方案原始 algebra",
    );
  } else {
    previewLines.push(...generatedRules.map((rule) => `    - ${rule}`));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="模糊音"
        description="为常见的平翘舌、前后鼻音、n/l 混淆建立容错。模糊音会显著增加重码，建议按需开启。"
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

      {!data.compiled && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <span className="mt-0.5 shrink-0 text-warn">
            <Icon name="warning" size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">当前读取的是方案原文（尚未部署）</p>
            <p className="mt-0.5 text-xs leading-5 text-warn/90">
              规则可能不含 __include 展开，建议先部署一次，再回来应用模糊音。
            </p>
          </div>
        </div>
      )}

      {staleBuild && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <span className="mt-0.5 shrink-0 text-warn">
            <Icon name="warning" size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">已写入，但 build 产物尚未重新编译</p>
            <p className="mt-0.5 text-xs leading-5 text-warn/90">
              get_fuzzy_settings 读取的是 build/&lt;id&gt;.schema.yaml；本次保存要等「保存并部署」
              （或在输入法里重新部署）后才会反映到规则总数与勾选反推。下方勾选保留的是你刚保存的选择。
            </p>
          </div>
        </div>
      )}

      <Card
        title={`当前方案 · ${data.schema_name}`}
        description={
          <span className="font-mono text-2xs">{data.schema_id}</span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={data.compiled ? "ok" : "warn"} dot>
              {data.compiled ? "已部署（build）" : "未部署（方案原文）"}
            </Badge>
            <Badge tone="neutral">algebra {data.rule_count} 条</Badge>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <span className="text-muted">
            已选 <span className="font-mono tabular text-accent">{orderedSelected.length}</span> /{" "}
            {data.groups.length} 组
          </span>
          <span className="text-muted">
            将生成{" "}
            <span className="font-mono tabular text-text">{generatedRules.length}</span> 条模糊音规则
          </span>
          <Badge tone={dirty ? "warn" : "neutral"} dot>
            {dirty ? "未保存" : "与方案一致"}
          </Badge>
        </div>
        <p className="mt-2 text-2xs leading-5 text-faint">
          分组与规则来自后端 `fuzzy::FuzzyGroup`；勾选状态由当前方案的 algebra 反推（一组规则全部存在才算启用）。
        </p>
      </Card>

      <div className="grid grid-cols-[1.25fr_1fr] gap-4">
        <Card
          title="模糊音分组"
          description="勾选即加入 / 移除该组的 derive 规则；勾选顺序不影响生成顺序"
          flush
        >
          <div className="divide-y divide-line-soft">
            {data.groups.map((group) => {
              const checked = selectedSet.has(group.id);
              return (
                <div
                  key={group.id}
                  className={cn(
                    "flex items-start justify-between gap-4 px-4 py-3 transition-colors",
                    checked ? "bg-accent/[0.04]" : "hover:bg-raised/40",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-text">{group.label}</span>
                      <code className="rounded border border-line bg-raised/60 px-1 py-px font-mono text-2xs text-faint">
                        {group.id}
                      </code>
                      {checked && <Badge tone="accent">已选</Badge>}
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      {group.rules.map((rule) => (
                        <code
                          key={rule}
                          className="block break-all font-mono text-2xs leading-5 text-muted"
                        >
                          {rule}
                        </code>
                      ))}
                    </div>
                  </div>
                  <Switch
                    checked={checked}
                    onChange={(next) => toggle(group.id, next)}
                    label={`启用模糊音 ${group.label}`}
                    disabled={busy !== null}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4">
          <Card
            title="生成的 algebra"
            description="截取本次追加的规则；保存时会与方案原有规则合并后整段写入"
            actions={<Badge tone="accent">{generatedRules.length} 条</Badge>}
          >
            <pre className="overflow-x-auto rounded-md border border-line-soft bg-base/50 p-3 font-mono text-2xs leading-5 text-muted">
              {previewLines.join("\n")}
            </pre>
            <p className="mt-3 text-2xs leading-5 text-faint">
              预览只列出「模糊音新增的规则」。方案原有的非模糊音规则由后端保留，不会出现在这个片段里。
            </p>
          </Card>

          <Card title="写入行为（重要）">
            <ul className="space-y-2.5 text-xs leading-5 text-muted">
              <li className="flex gap-2">
                <span className="shrink-0 text-accent">•</span>
                <span>
                  应用时会<span className="text-text">先剥离旧的模糊音规则，再按当前选择重建</span>
                  `speller/algebra`，所以反复保存不会让规则膨胀（幂等）。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-warn">•</span>
                <span>
                  会<span className="text-text">整段替换</span>该方案的 algebra：写入的是「方案原有规则 + 选中组规则」，
                  方案 custom 文件里其它来源的 algebra 改动会被覆盖。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-accent">•</span>
                <span>
                  未选中任何组时也能保存：等于把所有模糊音规则剥离，恢复方案原始 algebra。
                </span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 text-faint">•</span>
                <span>
                  保存只写 `&lt;schema_id&gt;.custom.yaml`；要真正生效需要「保存并部署」或在输入法里重新部署。
                </span>
              </li>
            </ul>
            {writtenFiles.length > 0 && (
              <p className="mt-3 break-all font-mono text-2xs text-faint">
                上次写入：{writtenFiles.join("、")}
              </p>
            )}
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
              ? `模糊音已写入${writtenFiles.length > 0 ? ` ${writtenFiles.join("、")}` : ""}，并已触发外壳重载。`
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
