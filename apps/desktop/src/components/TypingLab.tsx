import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/cn";
import { ipc, type PreviewTypingResult } from "@/lib/ipc";
import { errorMessage, toast } from "@/lib/toast";
import { useIpcQuery } from "@/lib/useIpcQuery";

/** 快捷测试串：覆盖二字常用词、三字词与「上屏一个词」的典型场景。 */
const QUICK_KEYS = ["nihao", "zhongguo", "women"] as const;

/** 输入防抖：连打时只发最后一次 preview_typing。 */
const PREVIEW_DEBOUNCE_MS = 200;

type Busy = "commit" | "deploy" | "shutdown" | null;

/**
 * 试打字面板：用进程内 librime 的临时会话跑真实音码 → 候选 → 上屏，
 * 不污染任何真实输入法会话（每次预览都会新建并销毁 session）。
 *
 * stub 构建（`engine_status().linked === false`）时整块换成说明卡片：
 * 试打字没有「静态降级」的意义，留空或报错都会误导用户。
 */
export function TypingLab() {
  const engine = useIpcQuery(() => ipc.engineStatus());
  const [keysInput, setKeysInput] = useState<string>(QUICK_KEYS[0]);
  const [keys, setKeys] = useState<string>(QUICK_KEYS[0]);
  const [committed, setCommitted] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const [deployLog, setDeployLog] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const engineLinked = engine.data?.linked === true;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setKeys(keysInput.trim()),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [keysInput]);

  const preview = useIpcQuery<PreviewTypingResult | null>(
    () => (engineLinked && keys ? ipc.previewTyping(keys) : Promise.resolve(null)),
    [engineLinked, keys],
  );

  // 输入串一变就清掉上一次的上屏回显，避免张冠李戴。
  useEffect(() => {
    setCommitted(null);
  }, [keys]);

  // 自动聚焦：等引擎状态回来、输入框真正挂载后再聚焦。
  useEffect(() => {
    if (engineLinked) inputRef.current?.focus();
  }, [engineLinked]);

  // 预览会惰性创建引擎：拿到结果后刷新一次状态，避免引擎徽标停在「未创建」。
  useEffect(() => {
    if (preview.data) engine.reload();
  }, [preview.data, engine.reload]);

  const data = preview.data;
  const candidates = data?.candidates ?? [];
  /** 契约 2：有 preedit 却无候选，多半是「尚未部署 / 方案未编译」，引导去部署而不是报错。 */
  const emptyCandidates =
    data !== null && data.preedit !== "" && data.candidates.length === 0;
  /** 契约 1：ascii_mode 下字母键由宿主直出，accepted_keys 会小于 keys.length。 */
  const acceptedShort = data !== null && data.accepted_keys < keys.length;

  function pickQuick(value: string) {
    setKeysInput(value);
    // 快捷串是显式动作，不必等防抖，否则高亮与预览会慢半拍。
    setKeys(value);
    setCommitted(null);
    setNote(null);
    setDeployLog(null);
    inputRef.current?.focus();
  }

  async function commit(index: number) {
    if (busy || !data) return;
    setBusy("commit");
    setNote(null);
    try {
      const text = await ipc.previewCommit(keys, index);
      if (text === null) {
        setCommitted(null);
        setNote(`候选 ${index + 1} 没有可上屏内容（引擎返回 null）。`);
        toast("该候选没有上屏内容", "danger");
        return;
      }
      setCommitted(text);
    } catch (error) {
      setNote(errorMessage(error));
      toast("上屏失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  /** 进程内部署：候选为空时的就地修复；失败时后端会自动退回子进程部署。 */
  async function deployInProcess() {
    if (busy) return;
    setBusy("deploy");
    setNote(null);
    try {
      const result = await ipc.deployInProcess();
      setDeployLog(result.log);
      toast(
        result.ok ? "进程内部署完成，正在重试预览" : "进程内部署失败，请查看日志",
        result.ok ? "ok" : "danger",
      );
      engine.reload();
      preview.reload();
    } catch (error) {
      setNote(errorMessage(error));
      toast("进程内部署失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  async function shutdown() {
    if (busy) return;
    setBusy("shutdown");
    setNote(null);
    try {
      const status = await ipc.shutdownEngine();
      // 刻意不 reload 预览：立刻重试会马上把引擎又建起来，看不到「已销毁」的状态。
      engine.reload();
      setCommitted(null);
      const message = status.initialized
        ? "引擎仍处于初始化状态（销毁未生效）。"
        : "引擎已销毁；下次预览会自动重建（冷启动会慢一点）。";
      setNote(message);
      toast(status.initialized ? "销毁引擎未生效" : "引擎已销毁", status.initialized ? "danger" : "ok");
    } catch (error) {
      setNote(errorMessage(error));
      toast("销毁引擎失败", "danger");
    } finally {
      setBusy(null);
    }
  }

  const headerActions = (
    <div className="flex items-center gap-2">
      {engine.data &&
        (engine.data.linked ? (
          <Badge tone="ok" dot>
            引擎 {engine.data.version}
          </Badge>
        ) : (
          <Badge tone="neutral" dot>
            未链接 librime
          </Badge>
        ))}
      {engine.data?.linked && (
        <Badge tone={engine.data.initialized ? "accent" : "neutral"} dot>
          {engine.data.initialized ? "引擎已初始化" : "引擎未创建"}
        </Badge>
      )}
    </div>
  );

  // 引擎状态读取失败：只提示失败原因，不假装能用。
  if (engine.data === null && engine.error) {
    return (
      <Card
        title="试打字"
        description="engine_status() / preview_typing() / preview_commit()"
        actions={
          <Button size="sm" variant="ghost" onClick={engine.reload}>
            <Icon name="search" size={14} />
            重试
          </Button>
        }
      >
        <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
          读取引擎状态失败：{engine.error}
        </p>
      </Card>
    );
  }

  // stub 构建：整块替换为说明卡片（不是报错、也不留空）。
  if (engine.data && !engine.data.linked) {
    return (
      <Card
        title="试打字"
        description="engine_status() / preview_typing() / preview_commit()"
        actions={headerActions}
      >
        <div className="rounded-md border border-dashed border-line bg-base/40 px-4 py-6 text-center">
          <p className="text-xs font-medium text-muted">本次构建未链接 librime（stub）</p>
          <p className="mx-auto mt-1.5 max-w-xl text-2xs leading-5 text-faint">
            试打字依赖进程内 librime：当前构建只有 stub FFI，因此不提供真实候选。接入真实引擎的构建（
            <code className="mx-1 rounded bg-raised px-1 font-mono">cargo build</code>
            按平台链接 librime 后）会自动变成可交互面板；外观页的候选窗预览仍可用静态示例配色。
          </p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={engine.reload}>
            <Icon name="search" size={14} />
            重新读取引擎状态
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="试打字"
      description="真实引擎（临时会话，不影响正在用输入法的窗口）"
      actions={headerActions}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-[1.3fr_1fr] gap-4">
          {/* 左：输入 + preedit + 候选 */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={keysInput}
                spellCheck={false}
                autoComplete="off"
                aria-label="试打字输入"
                placeholder="输入拼音，例如 nihao"
                onChange={(event) => {
                  setKeysInput(event.target.value);
                  setCommitted(null);
                  setNote(null);
                }}
                className="h-8 w-48 rounded-md border border-line bg-raised px-2.5 font-mono text-xs text-text outline-none focus:border-accent/60"
              />
              <span className="text-2xs text-faint">快捷测试</span>
              {QUICK_KEYS.map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={keys === item ? "secondary" : "ghost"}
                  onClick={() => pickQuick(item)}
                >
                  <span className="font-mono">{item}</span>
                </Button>
              ))}
            </div>

            <div className="rounded-md border border-line-soft bg-base/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-2xs text-faint">preedit</span>
                <span className="rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 font-mono text-xs text-accent-hover">
                  {data?.preedit || (keys ? "…" : "（空）")}
                </span>
                <span className="ml-auto text-2xs text-faint">
                  方案{" "}
                  <span className="font-mono text-muted">{data?.schema ?? "—"}</span>
                  {" · 按键 "}
                  <span
                    className={cn("tabular", acceptedShort ? "text-warn" : "text-muted")}
                    title="引擎消费的按键数 / 输入串长度"
                  >
                    {data?.accepted_keys ?? 0} / {keys.length}
                  </span>
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {preview.loading && !data ? (
                  <span className="py-1 text-2xs text-faint">读取候选…</span>
                ) : candidates.length === 0 && !emptyCandidates ? (
                  <span className="py-1 text-2xs text-faint">输入拼音开始试打。</span>
                ) : (
                  candidates.map((candidate, index) => (
                    <button
                      key={`${index}-${candidate.text}`}
                      type="button"
                      onClick={() => commit(index)}
                      disabled={busy !== null}
                      title={`上屏第 ${index + 1} 个候选`}
                      className={cn(
                        "flex items-baseline gap-1.5 rounded border px-2 py-1 text-left text-[13px] transition-colors",
                        "disabled:pointer-events-none disabled:opacity-45",
                        index === 0
                          ? "border-accent/50 bg-accent/15 text-accent-hover hover:bg-accent/25"
                          : "border-line bg-raised/60 text-text hover:border-line/80 hover:bg-raised",
                      )}
                    >
                      <span className="font-mono text-2xs text-faint">{index + 1}</span>
                      <span>{candidate.text}</span>
                      {candidate.comment && (
                        <span className="text-2xs text-faint">{candidate.comment}</span>
                      )}
                    </button>
                  ))
                )}
              </div>

              {emptyCandidates && (
                <div className="mt-2 flex items-start justify-between gap-3 rounded border border-warn/35 bg-warn/10 px-2.5 py-2">
                  <p className="min-w-0 text-2xs leading-5 text-warn">
                    引擎收到了「{data?.preedit}」但没有候选：可能尚未部署或方案未编译，点「进程内部署」按钮试试。
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={deployInProcess}
                    disabled={busy !== null}
                  >
                    {busy === "deploy" ? "部署中…" : "进程内部署"}
                  </Button>
                </div>
              )}

              {preview.error && (
                <div className="mt-2 flex items-start justify-between gap-3 rounded border border-warn/35 bg-warn/10 px-2.5 py-2">
                  <p className="min-w-0 whitespace-pre-wrap break-words text-2xs leading-5 text-warn">
                    预览失败：{preview.error}
                  </p>
                  <Button size="sm" variant="ghost" onClick={preview.reload} disabled={preview.loading}>
                    重试
                  </Button>
                </div>
              )}

              {acceptedShort && (
                <p className="mt-2 text-2xs leading-5 text-faint">
                  英文模式下按键由系统直出，引擎不参与（只消费了 {data?.accepted_keys} /{" "}
                  {keys.length} 个按键），这不是错误。
                </p>
              )}
            </div>
          </div>

          {/* 右：上屏回显 + 引擎操作 */}
          <div className="space-y-3">
            <div className="rounded-md border border-line bg-raised/40 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xs uppercase tracking-wide text-faint">上屏（模拟文本框）</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setCommitted(null)}
                  disabled={!committed}
                >
                  清空
                </Button>
              </div>
              <p
                aria-live="polite"
                className={cn(
                  "mt-1.5 min-h-6 break-words text-sm",
                  committed ? "text-text" : "text-faint",
                )}
              >
                {committed ? `上屏：${committed}` : "点击左侧候选，这里显示真正上屏的文字"}
              </p>
            </div>

            <div className="rounded-md border border-line-soft bg-base/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-2xs uppercase tracking-wide text-faint">引擎</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={shutdown}
                  disabled={busy !== null || !engine.data?.initialized}
                  title="销毁进程内引擎"
                >
                  <Icon name="diagnostics" size={14} />
                  {busy === "shutdown" ? "销毁中…" : "销毁引擎"}
                </Button>
              </div>
              <p className="mt-1 text-2xs leading-5 text-faint">
                销毁后下次预览会自动重建（首次创建会重新初始化 librime）。
              </p>
              <p className="mt-1 break-all font-mono text-2xs text-faint">
                {engine.data?.initialized
                  ? (engine.data.user_dir ?? "—")
                  : "引擎未创建：第一次预览时懒加载"}
              </p>
            </div>
          </div>
        </div>

        {note && (
          <p className="whitespace-pre-wrap break-words text-2xs leading-5 text-muted">{note}</p>
        )}

        {deployLog && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-base/60 p-2.5 font-mono text-2xs leading-5 text-muted">
            {deployLog}
          </pre>
        )}
      </div>
    </Card>
  );
}
