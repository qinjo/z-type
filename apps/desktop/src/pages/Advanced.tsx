import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import {
  ipc,
  type UserFile,
  type UserFileKind,
} from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

type DangerAction = "managed" | "lock";
type Busy = "reveal" | "save" | DangerAction | null;

/** 类型徽标的配色：custom 是 GUI 主战场用强调色，dict 用提醒色，其余中性。 */
const KIND_TONE: Record<UserFileKind, "accent" | "ok" | "warn" | "neutral"> = {
  custom: "accent",
  config: "neutral",
  schema: "ok",
  dict: "warn",
  installation: "neutral",
  other: "neutral",
};

const KIND_LABEL: Record<UserFileKind, string> = {
  custom: "custom",
  config: "config",
  schema: "schema",
  dict: "dict",
  installation: "installation",
  other: "other",
};

const KIND_HINT: Record<UserFileKind, string> = {
  custom: "custom.yaml：GUI 的托管目标，优先在对应页面修改",
  config: "普通配置（如 default.yaml），改动影响面较大",
  schema: "方案文件：改错会导致该方案无法加载",
  dict: "词典：体积大且逐行校验成本高，不在编辑器内打开",
  installation: "安装记录：由输入法维护，一般不必手改",
  other: "其它文本文件",
};

/** ISO8601 UTC → `YYYY-MM-DD HH:mm`（本地时区），解析失败时原样返回。 */
function formatModified(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 词典（体积）与后端标记为不可编辑的文件一律不进编辑器；
 * 判断条件与 Rust `UserFile::editable` 保持一致，本地再兜一层 dict。
 */
function canEdit(file: UserFile): boolean {
  return file.editable && file.kind !== "dict";
}

export function Advanced() {
  const files = useIpcQuery(() => ipc.listUserFiles());
  const env = useIpcQuery(() => ipc.getEnvInfo());

  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /** 当前选中的文件（按文件名跟随列表刷新，避免拿到过期的 size/mtime）。 */
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingReload, setConfirmingReload] = useState(false);

  const [confirmingDanger, setConfirmingDanger] = useState<DangerAction | null>(null);
  /** 有未保存修改时点击另一个文件：先确认要丢弃的草稿属于哪个文件。 */
  const [pendingPick, setPendingPick] = useState<UserFile | null>(null);

  /** 防止快速切换文件时旧请求覆盖新内容。 */
  const loadSeq = useRef(0);
  /** 同步去重：`busy` 是异步 state，两次 Cmd+S 在同一 tick 里都可能通过检查。 */
  const savingRef = useRef(false);
  const saveRef = useRef<() => void>(() => {});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selected = useMemo(
    () => files.data?.find((file) => file.name === selectedName) ?? null,
    [files.data, selectedName],
  );
  const editable = selected ? canEdit(selected) : false;
  const dirty = editable && draft !== baseline && !editorLoading;
  const lineCount = useMemo(() => draft.split("\n").length, [draft]);

  const loadFile = useCallback(async (name: string) => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    setEditorLoading(true);
    setEditorError(null);
    setSaveError(null);
    setConfirmingReload(false);
    try {
      const result = await ipc.readFile(name);
      if (loadSeq.current !== seq) return;
      setDraft(result.content);
      setBaseline(result.content);
      // 载入后把焦点放进编辑器，避免用户再点一次才能敲键盘。
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      if (loadSeq.current !== seq) return;
      // 读取失败时清空草稿，避免把上一个文件的内容误当成这个文件的。
      setDraft("");
      setBaseline("");
      setEditorError(errorMessage(error));
    } finally {
      if (loadSeq.current === seq) setEditorLoading(false);
    }
  }, []);

  function pick(file: UserFile) {
    setActionError(null);
    // 还有未保存修改时切换文件要先确认，否则草稿会无声丢失。
    if (dirty && selected && file.name !== selected.name) {
      setPendingPick(file);
      setConfirmingReload(false);
      return;
    }
    setPendingPick(null);
    setSelectedName(file.name);
    if (!canEdit(file)) {
      // 只读/词典：允许看元信息，但明确告知不进编辑器。
      setDraft("");
      setBaseline("");
      setEditorLoading(false);
      setEditorError(null);
      setSaveError(null);
      toast("词典/只读文件不在编辑器内打开（体积与风险）", "neutral");
      return;
    }
    void loadFile(file.name);
    toast(`已加载 ${file.name}`, "neutral");
  }

  async function save() {
    if (savingRef.current) return;
    if (!selected || !editable || busy) return;
    savingRef.current = true;
    setBusy("save");
    setSaveError(null);
    try {
      const result = await ipc.writeRawFile(selected.name, draft);
      setBaseline(draft);
      toast(
        result.snapshot_id
          ? `已写入 ${result.bytes} 字节 · 自动备份 ${result.snapshot_id}`
          : `已写入 ${result.bytes} 字节（未生成快照）`,
        "ok",
      );
      files.reload();
    } catch (error) {
      // 后端 Err(String) 原文（YAML 语法错误 / 非法文件名…）必须原样展示，草稿不重置。
      setSaveError(errorMessage(error));
      toast("保存失败，输入已保留", "danger");
    } finally {
      savingRef.current = false;
      setBusy(null);
    }
  }

  // 用 ref 承载最新的 save，避免 window 监听在每个 keystroke 上重建。
  useEffect(() => {
    saveRef.current = () => {
      void save();
    };
  });

  /** 编辑器打开时接管 Cmd/Ctrl+S，避免浏览器「另存网页」抢走快捷键。 */
  useEffect(() => {
    if (!selected || !editable) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, editable]);

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

  async function runDanger(action: DangerAction) {
    if (busy) return;
    setBusy(action);
    setActionError(null);
    try {
      const result =
        action === "managed"
          ? await ipc.resetManagedKeys()
          : await ipc.clearDeployLock();
      setConfirmingDanger(null);
      if (action === "managed") {
        toast(
          result.removed
            ? "已删除 .qieyun/state.json：托管键清单已清空，配置文件未改动"
            : "没有可重置的清单（.qieyun/state.json 不存在）",
          result.removed ? "ok" : "neutral",
        );
      } else {
        toast(
          result.removed
            ? "已清理残留的 .qieyun/deploy.lock"
            : "没有可清理的部署锁（deploy.lock 不存在）",
          result.removed ? "ok" : "neutral",
        );
      }
    } catch (error) {
      setActionError(errorMessage(error));
      toast("操作失败，后端未做任何改动", "danger");
    } finally {
      setBusy(null);
    }
  }

  const userDir = env.data?.rime_user_dir ?? "";

  const header = (
    <PageHeader
      title="高级"
      description="这里的修改绕过 GUI 校验，保存前会自动快照，但仍建议优先用对应页面。"
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={revealUserDir}
          disabled={busy !== null || !userDir}
          title={userDir ? `在文件管理器中显示 ${userDir}` : "读取用户目录后才能显示"}
        >
          <Icon name="folder" size={14} />
          在 Finder 中显示
        </Button>
      }
    />
  );

  const userDirCard = (
    <Card title="用户目录" description="get_env_info() · 下面所有文件都在这个目录里">
      {env.error ? (
        <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
          读取用户目录失败：{env.error}
        </p>
      ) : !env.data ? (
        <p className="text-xs text-faint">读取中…</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className="min-w-0 break-all rounded border border-line-soft bg-base/40 px-2.5 py-1.5 font-mono text-2xs text-text"
            title={env.data.rime_user_dir}
          >
            {env.data.rime_user_dir}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={revealUserDir}
            disabled={busy !== null}
          >
            <Icon name="external" size={14} />
            {busy === "reveal" ? "打开中…" : "在 Finder 中显示"}
          </Button>
        </div>
      )}
    </Card>
  );

  const fileList = (
    <Card
      title="文件清单"
      description={`list_user_files() · 共 ${files.data?.length ?? 0} 个 .yaml / .yml / .txt`}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={files.reload}
          disabled={files.loading}
        >
          <Icon name="search" size={14} />
          {files.loading ? "刷新中…" : "刷新"}
        </Button>
      }
      flush
    >
      {files.error ? (
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
            读取文件清单失败：{files.error}
          </p>
          <Button size="sm" variant="ghost" onClick={files.reload}>
            重试
          </Button>
        </div>
      ) : files.loading && !files.data ? (
        <p className="px-4 py-6 text-center text-xs text-faint">读取中…</p>
      ) : (files.data?.length ?? 0) === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-faint">
          用户目录里没有可展示的文本文件。
        </p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">文件名</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 text-right font-medium">大小</th>
              <th className="px-3 py-2.5 font-medium">修改时间</th>
              <th className="w-16 px-4 py-2.5 text-right font-medium">可编辑</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {(files.data ?? []).map((file) => {
              const openable = canEdit(file);
              const active = file.name === selectedName;
              return (
                <tr
                  key={file.name}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  className={cn(
                    "cursor-pointer outline-none transition-colors focus-visible:bg-raised/60",
                    active ? "bg-accent/10" : "hover:bg-raised/40",
                  )}
                  onClick={() => pick(file)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      pick(file);
                    }
                  }}
                  title={
                    openable
                      ? `点击在编辑器中打开 ${file.name}`
                      : "词典/只读文件不在编辑器内打开（体积与风险）"
                  }
                >
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "font-mono text-2xs",
                        active ? "text-accent-hover" : "text-text",
                      )}
                    >
                      {file.name}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={KIND_TONE[file.kind]}>{KIND_LABEL[file.kind]}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-2xs tabular text-muted">
                    {formatBytes(file.size_bytes)}
                  </td>
                  <td
                    className="px-3 py-2.5 font-mono text-2xs tabular text-faint"
                    title={file.modified ?? "读不到修改时间"}
                  >
                    {formatModified(file.modified)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span
                      className={cn(
                        "text-2xs",
                        openable ? "text-ok" : "text-faint",
                      )}
                    >
                      {openable ? "是" : "否"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="border-t border-line-soft px-4 py-2.5 text-2xs leading-5 text-faint">
        点击可编辑文件在右侧打开编辑器；<span className="text-muted">dict</span>{" "}
        与只读文件只展示元信息。
      </p>
    </Card>
  );

  const editorPanel = !selected ? (
    <Card title="原始编辑器" description="read_file() + write_raw_file()">
      <div className="rounded-md border border-line-soft bg-base/40 px-3 py-10 text-center">
        <p className="text-xs text-muted">从左侧文件清单里选一个可编辑文件</p>
        <p className="mx-auto mt-1 max-w-sm text-2xs leading-5 text-faint">
          保存会调用 write_raw_file：后端先校验 YAML、自动快照，再原子落盘。
        </p>
      </div>
    </Card>
  ) : !editable ? (
    <Card
      title="文件元信息"
      description={`${selected.name} · 只读`}
      actions={<Badge tone={KIND_TONE[selected.kind]}>{KIND_LABEL[selected.kind]}</Badge>}
    >
      <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2.5">
        <p className="text-xs font-medium text-warn">
          词典/只读文件不在编辑器内打开（体积与风险）
        </p>
        <p className="mt-1 text-2xs leading-5 text-warn/90">
          这类文件动辄数十 MB，逐行编辑既慢又容易破坏格式；请用专门的词典工作流处理，
          或直接在系统编辑器里修改后重新部署。
        </p>
      </div>
      <dl className="mt-3 space-y-2 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="shrink-0 text-faint">文件名</dt>
          <dd className="min-w-0 break-all text-right font-mono text-2xs text-text">
            {selected.name}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0 text-faint">类型</dt>
          <dd className="text-right text-text">{KIND_HINT[selected.kind]}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0 text-faint">大小</dt>
          <dd className="font-mono text-2xs tabular text-text">
            {formatBytes(selected.size_bytes)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0 text-faint">修改时间</dt>
          <dd className="font-mono text-2xs tabular text-text">
            {formatModified(selected.modified)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="shrink-0 text-faint">可编辑</dt>
          <dd className="text-text">否（editable = false）</dd>
        </div>
      </dl>
    </Card>
  ) : (
    <Card
      title="原始编辑器"
      description={
        <>
          {selected.name} · {KIND_HINT[selected.kind]}
        </>
      }
      actions={
        <Badge tone={dirty ? "warn" : "neutral"} dot>
          {editorLoading ? "读取中" : dirty ? "未保存" : "与磁盘一致"}
        </Badge>
      }
    >
      {pendingPick && (
        <div
          role="alertdialog"
          aria-label="确认切换文件"
          className="mb-3 flex items-start justify-between gap-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">当前文件有未保存的修改</p>
            <p className="mt-0.5 break-words text-2xs leading-5 text-warn/90">
              切换到 {pendingPick.name} 会丢弃 {selected.name} 的未保存修改（
              {draft.length} 字符）。要放弃并切换吗？
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingPick(null)}
              disabled={busy !== null}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                const next = pendingPick;
                setPendingPick(null);
                setDraft("");
                setBaseline("");
                setSelectedName(next.name);
                if (canEdit(next)) void loadFile(next.name);
                else {
                  setEditorLoading(false);
                  toast("词典/只读文件不在编辑器内打开（体积与风险）", "neutral");
                }
              }}
              disabled={busy !== null}
            >
              放弃并切换
            </Button>
          </div>
        </div>
      )}

      {editorError && (
        <div
          role="alert"
          className="mb-3 flex items-start justify-between gap-3 rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-danger">读取文件失败</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs leading-5 text-danger/90">
              {editorError}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadFile(selected.name)}
            disabled={busy !== null}
          >
            重试
          </Button>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2.5 rounded-md border border-danger/35 bg-danger/10 px-3 py-2.5"
        >
          <span className="mt-0.5 shrink-0 text-danger">
            <Icon name="warning" size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-danger">保存被后端拒绝（输入已保留）</p>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs leading-5 text-danger/90">
              {saveError}
            </p>
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-label={`${selected.name} 的原始内容`}
        placeholder={editorLoading ? "读取中…" : "（空文件）"}
        className="h-[26rem] w-full resize-y overflow-auto rounded-md border border-line bg-base/60 p-3 font-mono text-2xs leading-5 text-text outline-none focus:border-accent/60"
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-2xs text-faint">
          <span className="tabular">{lineCount} 行</span>
          <span className="tabular">{draft.length} 字符</span>
          <span className="tabular">{formatBytes(selected.size_bytes)}（磁盘）</span>
          <span className="hidden sm:inline">⌘/Ctrl + S 保存</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setActionError(null);
              setConfirmingReload(true);
            }}
            disabled={busy !== null || editorLoading}
          >
            重新加载
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={save}
            disabled={busy !== null || editorLoading || !dirty}
            title={dirty ? "写入用户目录（自动快照）" : "没有未保存的修改"}
          >
            <Icon name="check" size={14} />
            {busy === "save" ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      {confirmingReload && (
        <div
          role="alertdialog"
          aria-label="确认放弃未保存修改"
          className="mt-3 flex items-start justify-between gap-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">确认重新加载？</p>
            <p className="mt-0.5 break-words text-2xs leading-5 text-warn/90">
              将丢弃当前未保存的修改（{dirty ? `${draft.length} 字符` : "当前无改动"}），
              并从磁盘重新读取 {selected.name}。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingReload(false)}
              disabled={busy !== null}
            >
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => void loadFile(selected.name)}
              disabled={busy !== null}
            >
              确认重载
            </Button>
          </div>
        </div>
      )}
    </Card>
  );

  const dangerZone = (
    <Card
      title={
        <span className="text-danger">
          <Icon name="warning" size={14} className="mr-1.5 inline align-[-2px]" />
          危险操作
        </span>
      }
      description="每一项都需要二次确认；执行结果直接来自后端"
      className="border-danger/30"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-line-soft bg-base/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-text">重置托管键清单</p>
            <Badge tone="warn">不可自动恢复</Badge>
          </div>
          <p className="mt-1.5 text-2xs leading-5 text-muted">
            只删除 <span className="font-mono">.qieyun/state.json</span> 里「哪些键归 GUI
            管」的记录，<span className="text-text">不动任何配置</span>
            ；之后在对应页面重写会重新接管（那一次写回不再做漂移检测）。
          </p>
          <p className="mt-1 text-2xs leading-5 text-faint">
            删掉的清单不会自动重建，需要靠一次成功的结构化保存重新生成；
            如需保留当前清单，请先创建快照。
          </p>
          {confirmingDanger === "managed" ? (
            <div className="mt-3 rounded border border-danger/35 bg-danger/10 px-2.5 py-2">
              <p className="text-2xs leading-5 text-danger">
                确认删除托管键清单？配置文件不会被改动，但 GUI 会「忘掉」自己管过哪些键。
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDanger(null)}
                  disabled={busy !== null}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void runDanger("managed")}
                  disabled={busy !== null}
                >
                  {busy === "managed" ? "执行中…" : "确认重置"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="danger"
              className="mt-3"
              onClick={() => {
                setActionError(null);
                setConfirmingDanger("managed");
              }}
              disabled={busy !== null}
            >
              重置清单
            </Button>
          )}
        </div>

        <div className="rounded-md border border-line-soft bg-base/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-text">清理部署锁</p>
            <Badge tone="neutral">可恢复</Badge>
          </div>
          <p className="mt-1.5 text-2xs leading-5 text-muted">
            删除残留的 <span className="font-mono">.qieyun/deploy.lock</span>
            ，用于部署器异常退出后卡在「部署进行中」的场景。
            <span className="text-text">仅在确认没有部署进行中时使用</span>
            ；锁会在下次部署时自动重新创建。
          </p>
          <p className="mt-1 text-2xs leading-5 text-faint">
            若部署确实还在跑，清锁会允许两个部署并发执行，可能互相覆盖 build/
            产物——请先确认没有正在进行的部署。
          </p>
          {confirmingDanger === "lock" ? (
            <div className="mt-3 rounded border border-danger/35 bg-danger/10 px-2.5 py-2">
              <p className="text-2xs leading-5 text-danger">
                确认清理部署锁？请先确认当前没有部署正在进行。
              </p>
              <div className="mt-2 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDanger(null)}
                  disabled={busy !== null}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void runDanger("lock")}
                  disabled={busy !== null}
                >
                  {busy === "lock" ? "执行中…" : "确认清理"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="danger"
              className="mt-3"
              onClick={() => {
                setActionError(null);
                setConfirmingDanger("lock");
              }}
              disabled={busy !== null}
            >
              清理部署锁
            </Button>
          )}
        </div>
      </div>
      <p className="mt-3 text-2xs leading-5 text-faint">
        两个操作都只删除 <span className="font-mono">.qieyun/</span>{" "}
        下的元数据文件，不会写入或删除任何 Rime 配置；失败时后端会把原因原样返回。
      </p>
    </Card>
  );

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

      {userDirCard}

      <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0 space-y-4">
          {fileList}
          <p className="px-1 text-2xs leading-5 text-faint">
            类型徽标：custom（GUI 托管）/ config / schema / dict（只读）/ installation / other。
            大小与修改时间来自 <span className="font-mono">list_user_files()</span>。
          </p>
        </div>
        <div className="min-w-0">{editorPanel}</div>
      </div>

      {dangerZone}
    </div>
  );
}
