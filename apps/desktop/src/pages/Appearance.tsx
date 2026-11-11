import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { CandidatePreview } from "@/components/CandidatePreview";
import { Card } from "@/components/Card";
import { ColorField } from "@/components/ColorField";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { NumberInput } from "@/components/NumberInput";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import {
  THEME_COLOR_SLOTS,
  ipc,
  type DeployResult,
  type FontDto,
  type LayoutDto,
  type ThemeColorSlot,
  type ThemePreset,
  type WriteResult,
} from "@/lib/ipc";
import {
  cloneTheme,
  cssColor,
  isDarkTheme,
  validateTheme,
} from "@/lib/theme";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

const SLOT_LABELS: Record<ThemeColorSlot, string> = {
  back: "背景",
  border: "边框",
  text: "输入文字",
  candidate_text: "候选文字",
  comment_text: "注释文字",
  hilited_back: "高亮背景",
  hilited_text: "高亮文字",
  hilited_candidate_back: "高亮候选背景",
  hilited_candidate_text: "高亮候选文字",
  hilited_candidate_border: "高亮候选边框",
  hilited_border: "高亮边框",
};

/** 预设卡片上的颜色条槽位。 */
const SWATCH_SLOTS: ThemeColorSlot[] = [
  "back",
  "text",
  "candidate_text",
  "hilited_candidate_back",
  "hilited_back",
  "border",
];

/** 用规范化后的字段生成签名，仅用于判断「相对预设是否有未保存改动」。 */
function themeSignature(theme: ThemePreset): string {
  const { theme: normalized } = validateTheme(theme);
  return JSON.stringify({
    name: normalized.name,
    font: normalized.font,
    layout: normalized.layout,
    colors: normalized.colors,
  });
}

type Busy = "save" | "deploy" | null;

export function Appearance() {
  const presets = useIpcQuery(() => ipc.listThemePresets());
  const [draft, setDraft] = useState<ThemePreset | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [invalidSlots, setInvalidSlots] = useState<ThemeColorSlot[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [writtenFiles, setWrittenFiles] = useState<string[]>([]);
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // 首次加载 / 重新拉取后，把第一个预设载入为可编辑草稿（已有同名草稿则保留用户编辑）。
  useEffect(() => {
    const list = presets.data;
    if (!list?.length) return;
    setDraft((current) => {
      if (!current) return cloneTheme(list[0]!);
      const same = list.find((preset) => preset.name === current.name);
      return same ? current : cloneTheme(list[0]!);
    });
  }, [presets.data]);

  const original = useMemo(
    () => presets.data?.find((preset) => preset.name === draft?.name) ?? null,
    [presets.data, draft?.name],
  );
  const dirty = useMemo(
    () => (draft && original ? themeSignature(draft) !== themeSignature(original) : false),
    [draft, original],
  );

  function patchDraft(updater: (theme: ThemePreset) => ThemePreset) {
    setDraft((current) => (current ? updater(current) : current));
  }

  function updateFont(patch: Partial<FontDto>) {
    patchDraft((theme) => ({ ...theme, font: { ...theme.font, ...patch } }));
  }

  function updateLayout(patch: Partial<LayoutDto>) {
    patchDraft((theme) => ({ ...theme, layout: { ...theme.layout, ...patch } }));
  }

  function updateColor(slot: ThemeColorSlot, value: string) {
    patchDraft((theme) => ({ ...theme, colors: { ...theme.colors, [slot]: value } }));
    setInvalidSlots((current) => current.filter((item) => item !== slot));
  }

  function selectPreset(preset: ThemePreset) {
    setDraft(cloneTheme(preset));
    setInvalidSlots([]);
    setActionError(null);
  }

  function resetDraft() {
    if (original) {
      setDraft(cloneTheme(original));
      setInvalidSlots([]);
      setActionError(null);
    }
  }

  /** 校验 + 写入；校验失败时把错误原文/槽位展示出来并中止。 */
  async function applyDraft(): Promise<{ theme: ThemePreset; written: WriteResult } | null> {
    if (!draft) return null;
    const { theme, invalidColors, fontProblem } = validateTheme(draft);
    if (invalidColors.length > 0 || fontProblem) {
      setInvalidSlots(invalidColors);
      const problems: string[] = [];
      if (fontProblem) problems.push(fontProblem);
      if (invalidColors.length > 0) {
        const detail = invalidColors
          .map((slot) => `${SLOT_LABELS[slot]}（${slot}）`)
          .join("、");
        problems.push(`以下颜色槽不是合法 hex（#RRGGBB 或 #RRGGBBAA）：${detail}`);
      }
      setActionError(problems.join("；"));
      toast("提交前校验未通过", "danger");
      return null;
    }

    setInvalidSlots([]);
    setActionError(null);
    setDraft(theme);
    const written = await ipc.applyTheme(theme);
    setWrittenFiles(written.written_files);
    return { theme, written };
  }

  async function save() {
    if (!draft || busy) return;
    setBusy("save");
    try {
      const applied = await applyDraft();
      if (!applied) return;
      const files = applied.written.written_files;
      toast(
        files.length > 0 ? `已保存 · 写入 ${files.join("、")}` : "已保存（无文件变更）",
        "ok",
      );
    } catch (error) {
      setActionError(errorMessage(error));
      toast("保存失败，后端已中止写入", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndDeploy() {
    if (!draft || busy) return;
    setBusy("deploy");
    setDeploy(null);
    try {
      const applied = await applyDraft();
      if (!applied) return;
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

  if (!draft) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="外观主题"
          description="选择候选窗配色、字体与布局。所有改动写入 squirrel.custom.yaml（macOS）/ weasel.custom.yaml（Windows）。"
          actions={
            presets.error ? (
              <Button size="sm" onClick={presets.reload}>
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="主题预设" description="来自 list_theme_presets()">
          {presets.error ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
              读取主题预设失败：{presets.error}
            </p>
          ) : presets.loading ? (
            <p className="text-xs text-faint">读取中…</p>
          ) : (
            <p className="text-xs text-faint">后端没有返回任何主题预设。</p>
          )}
        </Card>
      </div>
    );
  }

  const activePreset = draft;

  return (
    <div className="space-y-5">
      <PageHeader
        title="外观主题"
        description="选择候选窗配色、字体与布局。所有改动写入 squirrel.custom.yaml（macOS）/ weasel.custom.yaml（Windows）。"
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

      <div className="grid grid-cols-[1.05fr_1fr] gap-4">
        <Card
          title="主题预设"
          description="来自 list_theme_presets()；点击卡片载入为可编辑草稿"
          actions={
            <Badge tone={dirty ? "warn" : "neutral"} dot>
              {dirty ? "未保存" : "与预设一致"}
            </Badge>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            {(presets.data ?? []).map((preset) => {
              const isActive = preset.name === activePreset.name;
              const dark = isDarkTheme(preset);
              return (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => selectPreset(preset)}
                  aria-pressed={isActive}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    isActive
                      ? "border-accent/60 bg-accent/5"
                      : "border-line bg-base/30 hover:border-line/80 hover:bg-raised/40",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-text">
                      {preset.name}
                    </span>
                    <Badge tone={dark ? "neutral" : "warn"}>{dark ? "深色" : "浅色"}</Badge>
                  </div>
                  <div className="mt-2 flex h-8 overflow-hidden rounded border border-black/30">
                    {SWATCH_SLOTS.map((slot) => (
                      <span
                        key={slot}
                        className="flex-1"
                        title={`${SLOT_LABELS[slot]} ${preset.colors[slot] ?? ""}`}
                        style={{ backgroundColor: cssColor(preset.colors[slot] ?? "", "#000000") }}
                      />
                    ))}
                  </div>
                  <p className="mt-1.5 truncate font-mono text-2xs text-faint">
                    {preset.font.face} · {preset.font.point}pt ·{" "}
                    {preset.layout.orientation === "vertical" ? "竖排" : "横排"} · 圆角{" "}
                    {preset.layout.corner_radius}
                  </p>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-2xs text-faint">
            当前编辑：<span className="text-muted">{activePreset.name}</span>
            {dirty && " · 有未保存修改，切换预设会丢弃"}
          </p>
        </Card>

        <Card
          title="候选窗预览"
          description={`${activePreset.name} · 实时渲染（改一个值马上可见）`}
          actions={
            <Badge tone="accent" dot>
              Preview
            </Badge>
          }
        >
          <CandidatePreview theme={activePreset} />
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="字体" description="字体缺失时由系统回退，预览可能略有差异">
          <Field label="字体 face" hint="Squirrel 使用 font_face；Weasel 同样写入 font_face">
            <input
              type="text"
              aria-label="字体 face"
              value={activePreset.font.face}
              spellCheck={false}
              onChange={(event) => updateFont({ face: event.target.value })}
              className="h-8 w-52 rounded-md border border-line bg-raised px-2 font-mono text-xs text-text outline-none focus:border-accent/60"
            />
          </Field>
          <Field label="候选字号" hint="候选文字大小（pt）">
            <NumberInput
              ariaLabel="候选字号"
              value={activePreset.font.point}
              min={8}
              max={48}
              suffix="pt"
              onChange={(value) => updateFont({ point: value })}
            />
          </Field>
          <Field label="标签字号" hint="候选序号与状态栏文字大小">
            <NumberInput
              ariaLabel="标签字号"
              value={activePreset.font.label_point}
              min={6}
              max={32}
              suffix="pt"
              onChange={(value) => updateFont({ label_point: value })}
            />
          </Field>
          <Field label="行距" hint="多行候选之间的额外间距">
            <NumberInput
              ariaLabel="行距"
              value={activePreset.font.line_spacing}
              min={0}
              max={16}
              suffix="px"
              onChange={(value) => updateFont({ line_spacing: value })}
            />
          </Field>
        </Card>

        <Card title="布局" description="候选窗的形状与候选排列方式">
          <Field label="候选排列" hint="竖排用于单列候选窗">
            <div className="flex h-8 items-center gap-1 rounded-md border border-line bg-raised p-0.5">
              {(["horizontal", "vertical"] as const).map((orientation) => {
                const selected = activePreset.layout.orientation === orientation;
                return (
                  <button
                    key={orientation}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateLayout({ orientation })}
                    className={cn(
                      "h-6 rounded px-2.5 text-2xs transition-colors",
                      selected
                        ? "bg-accent/20 text-accent-hover"
                        : "text-muted hover:bg-line/60 hover:text-text",
                    )}
                  >
                    {orientation === "horizontal" ? "横排" : "竖排"}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="圆角" hint="候选窗圆角半径">
            <NumberInput
              ariaLabel="圆角"
              value={activePreset.layout.corner_radius}
              min={0}
              max={24}
              suffix="px"
              onChange={(value) => updateLayout({ corner_radius: value })}
            />
          </Field>
          <Field label="边框宽度" hint="0 表示无边框">
            <NumberInput
              ariaLabel="边框宽度"
              value={activePreset.layout.border_width}
              min={0}
              max={8}
              suffix="px"
              onChange={(value) => updateLayout({ border_width: value })}
            />
          </Field>
          <Field label="内边距" hint="候选窗内容与边缘的距离">
            <NumberInput
              ariaLabel="内边距"
              value={activePreset.layout.margin}
              min={0}
              max={40}
              suffix="px"
              onChange={(value) => updateLayout({ margin: value })}
            />
          </Field>
          <Field label="候选间距" hint="候选之间以及输入码与候选之间的间距">
            <NumberInput
              ariaLabel="候选间距"
              value={activePreset.layout.spacing}
              min={0}
              max={40}
              suffix="px"
              onChange={(value) => updateLayout({ spacing: value })}
            />
          </Field>
          <Field label="阴影" hint="0 表示不绘制阴影">
            <NumberInput
              ariaLabel="阴影"
              value={activePreset.layout.shadow}
              min={0}
              max={32}
              suffix="px"
              onChange={(value) => updateLayout({ shadow: value })}
            />
          </Field>
        </Card>
      </div>

      <Card
        title="颜色（11 个槽位）"
        description="支持 #RRGGBB；需要透明度时用 8 位 #RRGGBBAA，或调节右侧 Alpha（0–255）"
      >
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-3">
          {THEME_COLOR_SLOTS.map((slot) => (
            <ColorField
              key={slot}
              slot={slot}
              label={SLOT_LABELS[slot]}
              value={activePreset.colors[slot] ?? ""}
              invalid={invalidSlots.includes(slot)}
              onChange={(value) => updateColor(slot, value)}
            />
          ))}
        </div>
      </Card>

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
              ? `主题已写入${writtenFiles.length > 0 ? ` ${writtenFiles.join("、")}` : ""}，并已触发外壳重载。`
              : "部署未成功。可在「诊断与日志」查看详情，或稍后手动重新部署；主题文件本身已写入。"}
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
