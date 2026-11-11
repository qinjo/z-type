import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import {
  ipc,
  type AsciiToggleKey,
  type DeployResult,
  type InputSettings,
  type PageKeys,
  type WriteResult,
} from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type Busy = "save" | "deploy" | null;

interface KeyOption<T extends string> {
  value: T;
  label: string;
  hint: string;
  /** 实际写入 `key_binder/bindings` 的 YAML 行（流式），空数组表示不生成绑定。 */
  bindings: string[];
}

const PAGE_KEY_OPTIONS: KeyOption<PageKeys>[] = [
  {
    value: "comma_period",
    label: "逗号 / 句号",
    hint: "Rime 社区惯用键位：, 上一页、. 下一页",
    bindings: [
      "- {when: paging, accept: comma, send: Page_Up}",
      "- {when: has_menu, accept: period, send: Page_Down}",
    ],
  },
  {
    value: "bracket",
    label: "方括号",
    hint: "[ 上一页、] 下一页，与部分方案自带键位一致",
    bindings: [
      "- {when: paging, accept: bracketleft, send: Page_Up}",
      "- {when: has_menu, accept: bracketright, send: Page_Down}",
    ],
  },
  {
    value: "page_up_down",
    label: "PageUp / PageDown",
    hint: "外接键盘更顺手；键名分别是 Page_Up 与 Page_Down",
    bindings: [
      "- {when: paging, accept: Page_Up, send: Page_Up}",
      "- {when: has_menu, accept: Page_Down, send: Page_Down}",
    ],
  },
  {
    value: "off",
    label: "不设置",
    hint: "不生成翻页绑定，沿用方案自带的翻页键",
    bindings: [],
  },
];

const TOGGLE_OPTIONS: KeyOption<AsciiToggleKey>[] = [
  {
    value: "control_shift_space",
    label: "Control + Shift + 空格",
    hint: "Rime 社区常用组合，不易与单独按键冲突",
    bindings: ["- {when: always, accept: Control+Shift+space, toggle: ascii_mode}"],
  },
  {
    value: "shift_left",
    label: "左 Shift",
    hint: "单独按下并释放时切换；组合键（如 Shift+A）不受影响",
    bindings: ["- {when: always, accept: Shift_L, toggle: ascii_mode}"],
  },
  {
    value: "off",
    label: "不设置",
    hint: "不生成中英切换绑定，沿用方案或其它自定义绑定",
    bindings: [],
  },
];

interface OptionProps<T extends string> {
  option: KeyOption<T>;
  selected: boolean;
  disabled: boolean;
  onSelect: (value: T) => void;
}

function OptionRow<T extends string>({ option, selected, disabled, onSelect }: OptionProps<T>) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={() => onSelect(option.value)}
      className={cn(
        "w-full rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
        selected
          ? "border-accent/60 bg-accent/5"
          : "border-line bg-base/30 hover:border-line/80 hover:bg-raised/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-accent bg-accent/20" : "border-line",
          )}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
        <span className="text-[13px] text-text">{option.label}</span>
        {selected && <Badge tone="accent">选中</Badge>}
      </div>
      <p className="mt-1 pl-5 text-2xs text-faint">{option.hint}</p>
      <div className="mt-1.5 space-y-0.5 pl-5">
        {option.bindings.length > 0 ? (
          option.bindings.map((line) => (
            <code
              key={line}
              className="block break-all font-mono text-2xs leading-5 text-accent/80"
            >
              {line}
            </code>
          ))
        ) : (
          <span className="text-2xs text-faint">不写入任何绑定</span>
        )}
      </div>
    </button>
  );
}

/** 根据当前选择拼出 `key_binder/bindings` 的 YAML 片段（仅 GUI 管理的那批绑定）。 */
function buildBindingsYaml(pageKeys: PageKeys, toggleAscii: AsciiToggleKey): string {
  const page = PAGE_KEY_OPTIONS.find((option) => option.value === pageKeys);
  const toggle = TOGGLE_OPTIONS.find((option) => option.value === toggleAscii);
  const bindings = [...(page?.bindings ?? []), ...(toggle?.bindings ?? [])];

  if (bindings.length === 0) {
    return ["patch:", "  key_binder/bindings: []", "", "  # 未选择任何按键，不生成绑定"].join(
      "\n",
    );
  }
  return ["patch:", "  key_binder/bindings:", ...bindings.map((line) => `    ${line}`)].join(
    "\n",
  );
}

export function KeyBindings() {
  const settings = useIpcQuery(() => ipc.getInputSettings());
  const [draft, setDraft] = useState<InputSettings | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [writtenFiles, setWrittenFiles] = useState<string[]>([]);
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // 首屏与每次保存后，用后端返回值重置草稿；schema_list / page_size 原样透传。
  useEffect(() => {
    if (!settings.data) return;
    setDraft({ ...settings.data, schema_list: [...settings.data.schema_list] });
  }, [settings.data]);

  const original = settings.data;
  const dirty =
    draft !== null &&
    original !== null &&
    (draft.page_keys !== original.page_keys ||
      draft.toggle_ascii !== original.toggle_ascii);

  const yamlPreview = useMemo(
    () => (draft ? buildBindingsYaml(draft.page_keys, draft.toggle_ascii) : ""),
    [draft],
  );

  function updatePageKeys(value: PageKeys) {
    setActionError(null);
    setDraft((current) => (current ? { ...current, page_keys: value } : current));
  }

  function updateToggle(value: AsciiToggleKey) {
    setActionError(null);
    setDraft((current) => (current ? { ...current, toggle_ascii: value } : current));
  }

  function resetDraft() {
    if (!original) return;
    setDraft({ ...original, schema_list: [...original.schema_list] });
    setActionError(null);
  }

  /**
   * 本页只改按键，但 `apply_input_settings` 需要完整 InputSettings。
   * 写入前重新读一次最新设置，只把 page_keys / toggle_ascii 换成草稿值，
   * 避免用过期的 schema_list / page_size 覆盖「方案与启用」页刚保存的改动。
   */
  async function applyDraft(): Promise<WriteResult | null> {
    if (!draft) return null;
    setActionError(null);
    const latest = await ipc.getInputSettings();
    const payload: InputSettings = {
      ...latest,
      page_keys: draft.page_keys,
      toggle_ascii: draft.toggle_ascii,
    };
    const written = await ipc.applyInputSettings(payload);
    setWrittenFiles(written.written_files);
    return written;
  }

  async function save() {
    if (!draft || busy) return;
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
    if (!draft || busy) return;
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
          title="按键"
          description="配置翻页键与中英切换热键。改动会合并进 default.custom.yaml 的 key_binder 节点。"
          actions={
            settings.error ? (
              <Button size="sm" onClick={settings.reload}>
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="读取按键设置" description="get_input_settings()">
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="按键"
        description="配置翻页键与中英切换热键。改动会合并进 default.custom.yaml 的 key_binder 节点，你原有的其它绑定会保留。"
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

      <div className="grid grid-cols-2 gap-4">
        <Card
          title="翻页键"
          description="写入 key_binder/bindings 的 paging / has_menu 绑定"
          actions={
            <Badge tone={dirty && draft.page_keys !== original?.page_keys ? "warn" : "neutral"} dot>
              {dirty && draft.page_keys !== original?.page_keys ? "未保存" : "已保存"}
            </Badge>
          }
        >
          <div role="radiogroup" aria-label="翻页键" className="space-y-2">
            {PAGE_KEY_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                option={option}
                selected={draft.page_keys === option.value}
                disabled={busy !== null}
                onSelect={updatePageKeys}
              />
            ))}
          </div>
        </Card>

        <Card
          title="中英切换"
          description="写入 key_binder/bindings 的 ascii_mode toggle 绑定"
          actions={
            <Badge
              tone={dirty && draft.toggle_ascii !== original?.toggle_ascii ? "warn" : "neutral"}
              dot
            >
              {dirty && draft.toggle_ascii !== original?.toggle_ascii ? "未保存" : "已保存"}
            </Badge>
          }
        >
          <div role="radiogroup" aria-label="中英切换" className="space-y-2">
            {TOGGLE_OPTIONS.map((option) => (
              <OptionRow
                key={option.value}
                option={option}
                selected={draft.toggle_ascii === option.value}
                disabled={busy !== null}
                onSelect={updateToggle}
              />
            ))}
          </div>
        </Card>
      </div>

      <Card
        title="生成的 YAML 预览"
        description="根据当前选择拼出的 key_binder/bindings 片段，等宽字体可直接对照生成结果"
        actions={
          <Badge tone="accent" dot>
            key_binder/bindings
          </Badge>
        }
      >
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base/60 p-3 font-mono text-2xs leading-5 text-muted">
          {yamlPreview}
        </pre>
        <p className="mt-3 text-2xs leading-5 text-faint">
          GUI 只替换自己管理的键（
          <code className="font-mono text-muted">comma / period / bracketleft / bracketright / Page_Up / Page_Down / Control+Shift+space / Shift_L</code>
          ）；文件里你原有的其它绑定（如 emoji、简繁热键）会被完整保留。预览为便于阅读的流式写法，
          后端实际写入的是内容等价的块式 YAML。schema_list 与 menu/page_size 保持当前值，不在本页修改。
        </p>
        {writtenFiles.length > 0 && (
          <p className="mt-2 text-2xs text-faint">
            上次写入：<span className="font-mono text-muted">{writtenFiles.join("、")}</span>
          </p>
        )}
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
              ? `按键设置已写入${writtenFiles.length > 0 ? ` ${writtenFiles.join("、")}` : ""}，并已触发外壳重载。`
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
