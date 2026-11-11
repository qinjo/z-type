import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { ipc } from "@/lib/ipc";
import {
  SCHEMA_SOURCE_INFO,
  formatPunctValue,
  isRecord,
  punctEntries,
  punctKeyLabel,
} from "@/lib/schema";
import { useIpcQuery } from "@/lib/useIpcQuery";

/** 两列只读表格：按键 → 输出。 */
function PunctuationTable({ entries }: { entries: Array<[string, unknown]> }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
        <tr>
          <th className="w-28 px-4 py-2.5 font-medium">按键</th>
          <th className="px-4 py-2.5 font-medium">输出</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line-soft">
        {entries.map(([key, value]) => (
          <tr key={key} className="hover:bg-raised/40">
            <td className="px-4 py-2">
              <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-text">
                {punctKeyLabel(key)}
              </code>
            </td>
            <td className="px-4 py-2">
              <code className="break-all font-mono text-2xs text-accent">
                {formatPunctValue(value)}
              </code>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Punctuation() {
  const detail = useIpcQuery(() => ipc.getSchemaDetail());
  const [fullOpen, setFullOpen] = useState(false);

  const data = detail.data;
  const source = data ? SCHEMA_SOURCE_INFO[data.source] : null;
  const punctuator = data && isRecord(data.punctuator) ? data.punctuator : null;
  const halfShape = punctEntries(punctuator?.half_shape);
  const fullShape = punctEntries(punctuator?.full_shape);
  const missingPunctuator = punctuator === null || data?.source === "missing";

  if (!data) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="标点与符号"
          description="V1 标点只读：编辑将在支持按方案安全 patch punctuator 的嵌套键后提供。"
          actions={
            detail.error ? (
              <Button size="sm" onClick={detail.reload}>
                <Icon name="search" size={14} />
                重新读取
              </Button>
            ) : undefined
          }
        />
        <Card title="读取标点配置" description="get_schema_detail()（不传参数 = 当前默认方案）">
          {detail.error ? (
            <p className="whitespace-pre-wrap text-xs leading-5 text-danger">
              读取失败：{detail.error}
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
        title="标点与符号"
        description="V1 标点只读：编辑将在支持按方案安全 patch punctuator 的嵌套键后提供。"
        actions={
          <Button size="sm" variant="ghost" onClick={detail.reload}>
            <Icon name="search" size={14} />
            重新读取
          </Button>
        }
      />

      <div
        role="note"
        className="flex items-start gap-2.5 rounded-md border border-dashed border-line bg-base/40 px-3 py-2.5"
      >
        <span className="mt-px shrink-0 rounded border border-line bg-raised px-1 py-px font-mono text-2xs text-faint">
          V1
        </span>
        <p className="text-xs leading-5 text-muted">
          V1 标点只读，编辑将在支持按方案安全 patch{" "}
          <span className="font-mono text-2xs text-text">punctuator</span>{" "}
          的嵌套键后提供。当前页面只展示编译产物里的实际配置，便于核对。
        </p>
      </div>

      <Card
        title={`当前方案 · ${data.name}`}
        description={<span className="font-mono text-2xs">{data.id}</span>}
        actions={
          <Badge tone={source?.tone ?? "neutral"} dot>
            {source?.label ?? data.source}
          </Badge>
        }
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="neutral">half_shape {halfShape.length} 项</Badge>
          <Badge tone="neutral">full_shape {fullShape.length} 项</Badge>
          <Badge tone="neutral">switches {data.switches.length} 项</Badge>
          <span className="text-2xs text-faint">{source?.hint}</span>
        </div>
      </Card>

      {missingPunctuator ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-warn/35 bg-warn/10 px-3 py-2.5"
        >
          <span className="mt-0.5 shrink-0 text-warn">
            <Icon name="warning" size={15} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-warn">
              {data.source === "missing"
                ? "该方案文件未找到（source = missing）"
                : "该方案没有独立的 punctuator 配置（继承自 default）"}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-warn/90">
              {data.source === "missing"
                ? "用户目录与共享目录都没有该方案文件，请先部署或确认方案已安装。"
                : "Rime 会回落到 default 方案的标点配置；本页只展示当前方案自身声明的内容。"}
            </p>
          </div>
        </div>
      ) : (
        <>
          <Card
            title="半角按键映射 · half_shape"
            description="输入法处于半角模式时，按键实际提交的字符/成对符号"
            actions={<Badge tone="accent">{halfShape.length} 项</Badge>}
            flush
          >
            {halfShape.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-faint">
                该方案的 punctuator 没有 half_shape 段（可能继承 default）。
              </p>
            ) : (
              <PunctuationTable entries={halfShape} />
            )}
          </Card>

          {fullShape.length > 0 && (
            <Card
              title="全角映射 · full_shape"
              description="输入法处于全角模式时使用的映射"
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone="accent">{fullShape.length} 项</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setFullOpen((open) => !open)}
                  >
                    {fullOpen ? "收起" : "展开"}
                  </Button>
                </div>
              }
              flush={fullOpen}
            >
              {fullOpen ? (
                <PunctuationTable entries={fullShape} />
              ) : (
                <p className="text-xs text-faint">
                  已折叠 {fullShape.length} 条映射，点击「展开」查看。
                </p>
              )}
            </Card>
          )}
        </>
      )}

      <Card
        title="开关 · switches"
        description="方案声明的状态开关；实际切换由输入法热键完成"
        actions={<Badge tone="neutral">只读</Badge>}
        flush
      >
        {data.switches.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-faint">
            该方案没有声明 switches（会继承 default 的设置）。
          </p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">状态</th>
                <th className="w-24 px-4 py-2.5 font-medium">reset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {data.switches.map((item) => (
                <tr key={item.name} className="hover:bg-raised/40">
                  <td className="px-4 py-2.5 font-mono text-2xs text-text">{item.name}</td>
                  <td className="px-4 py-2.5">
                    {item.states.length === 0 ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <span className="font-mono text-2xs text-muted">
                        {item.states.join(" / ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-2xs tabular text-faint">
                    {item.reset === null ? "—" : item.reset}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="px-4 pb-4 pt-3 text-2xs leading-5 text-faint">
          这些开关在输入法里用热键切换；本版本只读，页面不会写回 switches。
        </p>
      </Card>

      {punctuator !== null && !missingPunctuator && (
        <Card
          title="原始 punctuator"
          description="后端返回的原始结构（未做任何解释），便于核对嵌套键"
        >
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line-soft bg-base/50 p-3 font-mono text-2xs leading-5 text-muted">
            {JSON.stringify(punctuator, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
