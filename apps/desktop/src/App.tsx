import { useEffect, useState, type ComponentType } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Icon, type IconName } from "@/components/Icon";
import { Advanced } from "@/pages/Advanced";
import { Appearance } from "@/pages/Appearance";
import { Diagnostics } from "@/pages/Diagnostics";
import { Dictionaries } from "@/pages/Dictionaries";
import { FuzzyPinyin } from "@/pages/FuzzyPinyin";
import { KeyBindings } from "@/pages/KeyBindings";
import { Overview } from "@/pages/Overview";
import { Punctuation } from "@/pages/Punctuation";
import { Schemas } from "@/pages/Schemas";
import { Shuangpin } from "@/pages/Shuangpin";
import { cn } from "@/lib/cn";
import { hasTauriBackend, ipc } from "@/lib/ipc";

type PageId =
  | "overview"
  | "schemas"
  | "appearance"
  | "keys"
  | "fuzzy"
  | "shuangpin"
  | "punctuation"
  | "dictionaries"
  | "advanced"
  | "diagnostics";

interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
  component: ComponentType;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    title: "工作台",
    items: [
      { id: "overview", label: "概览", icon: "overview", component: Overview },
      { id: "schemas", label: "方案与启用", icon: "schemas", component: Schemas },
      { id: "appearance", label: "外观主题", icon: "palette", component: Appearance },
      { id: "keys", label: "按键", icon: "keys", component: KeyBindings },
      { id: "fuzzy", label: "模糊音", icon: "fuzzy", component: FuzzyPinyin },
      { id: "shuangpin", label: "双拼", icon: "shuangpin", component: Shuangpin },
      { id: "punctuation", label: "标点与符号", icon: "punctuation", component: Punctuation },
      { id: "dictionaries", label: "词典", icon: "dictionary", component: Dictionaries },
    ],
  },
  {
    title: "系统",
    items: [
      { id: "advanced", label: "高级", icon: "advanced", component: Advanced },
      { id: "diagnostics", label: "诊断与日志", icon: "diagnostics", component: Diagnostics },
    ],
  },
];

const navItems = navSections.flatMap((section) => section.items);
const pageMap = new Map(navItems.map((item) => [item.id, item]));

function readRoute(): PageId {
  const hash = window.location.hash.replace(/^#\/?/, "").trim();
  return (pageMap.has(hash as PageId) ? hash : "overview") as PageId;
}

interface Toast {
  id: number;
  message: string;
  tone: "ok" | "danger" | "neutral";
}

export default function App() {
  const [activeId, setActiveId] = useState<PageId>(readRoute);
  const [backendReady] = useState(() => hasTauriBackend());
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState<"snapshot" | "deploy" | null>(null);

  const active = pageMap.get(activeId) ?? navItems[0]!;
  const Page = active.component;

  useEffect(() => {
    function onHashChange() {
      setActiveId(readRoute());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(id: PageId) {
    if (window.location.hash !== `#/${id}`) {
      window.location.hash = `#/${id}`;
    }
    setActiveId(id);
  }

  function notify(message: string, tone: Toast["tone"] = "neutral") {
    setToast({ id: Date.now(), message, tone });
  }

  async function createSnapshot() {
    setBusy("snapshot");
    try {
      const result = await ipc.createSnapshot("手动快照（GUI）");
      notify(`快照已创建：${result.id}`, "ok");
    } catch (error) {
      notify(`创建快照失败：${String(error)}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  async function deploy() {
    setBusy("deploy");
    try {
      const result = await ipc.deploy();
      notify(result.ok ? "部署完成" : "部署失败，请查看日志", result.ok ? "ok" : "danger");
    } catch (error) {
      notify(`部署失败：${String(error)}`, "danger");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full w-full bg-base">
      {/* 左侧固定导航 */}
      <aside className="flex w-[236px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-2.5 px-4 pb-4 pt-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/40 bg-accent/10 font-mono text-sm font-semibold text-accent">
            韵
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold tracking-tight text-text">
              切韵
            </p>
            <p className="truncate text-2xs text-faint">QIEYUN STUDIO · M0</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-2">
          {navSections.map((section) => (
            <div key={section.title} className="mb-4">
              <p className="mb-1 px-2 text-2xs font-medium uppercase tracking-widest text-faint/80">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate(item.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors",
                          isActive
                            ? "bg-raised text-text"
                            : "text-muted hover:bg-raised/60 hover:text-text",
                        )}
                      >
                        <span className={isActive ? "text-accent" : "text-faint"}>
                          <Icon name={item.icon} size={16} />
                        </span>
                        <span className="truncate">{item.label}</span>
                        {isActive && (
                          <span className="ml-auto h-1 w-1 rounded-full bg-accent" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line-soft px-3 py-3">
          <div className="rounded-md border border-line bg-base/40 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  backendReady ? "bg-ok" : "bg-warn",
                )}
              />
              <span className="text-2xs text-muted">
                {backendReady ? "Tauri 后端已连接" : "Mock 模式 · 未连接后端"}
              </span>
            </div>
            <p className="mt-1 font-mono text-2xs text-faint">v0.1.0 · GPL-3.0</p>
          </div>
        </div>
      </aside>

      {/* 右侧内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line bg-surface/60 px-6">
          <div className="flex min-w-0 items-center gap-2 text-2xs text-faint">
            <span className="text-muted">工作台</span>
            <span>/</span>
            <span className="truncate text-text">{active.label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={backendReady ? "ok" : "warn"} dot>
              {backendReady ? "已连接" : "Mock"}
            </Badge>
            <div className="mx-1 h-4 w-px bg-line" />
            <Button
              size="sm"
              variant="ghost"
              onClick={createSnapshot}
              disabled={busy !== null}
            >
              <Icon name="snapshot" size={14} />
              {busy === "snapshot" ? "创建中…" : "新建快照"}
            </Button>
            <Button size="sm" variant="primary" onClick={deploy} disabled={busy !== null}>
              <Icon name="deploy" size={14} />
              {busy === "deploy" ? "部署中…" : "部署"}
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1120px] px-6 py-6">
            <Page />
            <footer className="mt-8 flex items-center justify-between border-t border-line-soft pt-4 text-2xs text-faint">
              <span>切韵 · 前端骨架 M0 · 数据为占位 mock</span>
              <span className="font-mono">Tauri 2 · React 19 · Vite</span>
            </footer>
          </div>
        </main>
      </div>

      {toast && (
        <div
          role="status"
          className={cn(
            "fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-panel",
            toast.tone === "ok" && "border-ok/40 bg-[#10201a] text-ok",
            toast.tone === "danger" && "border-danger/40 bg-[#221114] text-danger",
            toast.tone === "neutral" && "border-line bg-raised text-text",
          )}
        >
          <Icon
            name={toast.tone === "ok" ? "check" : toast.tone === "danger" ? "warning" : "diagnostics"}
            size={14}
          />
          {toast.message}
        </div>
      )}
    </div>
  );
}
