import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { dictionaries } from "@/lib/demo-data";

const stats = [
  { label: "用户词典", value: "2 个", hint: "LevelDB · *.userdb" },
  { label: "总词条", value: "53,084", hint: "用户累计学习" },
  { label: "扩展词库", value: "2 个", hint: "仅 1 个被引用" },
  { label: "同步状态", value: "从未同步", hint: "未配置 sync_dir" },
];

export function Dictionaries() {
  const [entries, setEntries] = useState(dictionaries);

  function toggle(id: string, enabled: boolean) {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="词典"
        description="查看用户词典大小、管理扩展词库的启用状态。用户词典由 librime 维护，不建议手工编辑。"
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Icon name="snapshot" size={14} />
              导出备份
            </Button>
            <Button size="sm" variant="primary">
              <Icon name="plus" size={14} />
              导入词库
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <p className="text-2xs uppercase tracking-wide text-faint">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-text">{stat.value}</p>
            <p className="mt-0.5 text-2xs text-faint">{stat.hint}</p>
          </Card>
        ))}
      </div>

      <Card title="词典清单" description="来自用户目录与方案引用的词库文件" flush>
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">文件</th>
              <th className="px-4 py-2.5 font-medium">类型</th>
              <th className="px-4 py-2.5 text-right font-medium">大小</th>
              <th className="px-4 py-2.5 text-right font-medium">词条</th>
              <th className="px-4 py-2.5 font-medium">说明</th>
              <th className="w-20 px-4 py-2.5 text-right font-medium">启用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-raised/40">
                <td className="px-4 py-3">
                  <span className="font-mono text-2xs text-text">{entry.name}</span>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={entry.kind === "用户词典" ? "accent" : "neutral"}>
                    {entry.kind}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right font-mono text-2xs tabular text-muted">
                  {entry.size}
                </td>
                <td className="px-4 py-3 text-right font-mono text-2xs tabular text-muted">
                  {entry.entries}
                </td>
                <td className="px-4 py-3 text-faint">{entry.note}</td>
                <td className="px-4 py-3 text-right">
                  <Switch
                    checked={entry.enabled}
                    onChange={(next) => toggle(entry.id, next)}
                    label={`启用 ${entry.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="导入词库" description="支持 .txt / .dict.yaml / .userdb">
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line bg-base/30 px-4 py-6 text-center">
            <Icon name="dictionary" size={22} className="text-faint" />
            <p className="mt-2 text-xs text-muted">拖拽词库文件到此处，或点击选择</p>
            <p className="mt-1 text-2xs text-faint">文件会先复制到用户目录，不会修改共享目录</p>
            <Button size="sm" variant="secondary" className="mt-3">
              选择文件…
            </Button>
          </div>
        </Card>

        <Card title="同步" description="installation.yaml · sync_dir">
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span>同步目录</span>
              <span className="font-mono text-2xs text-faint">未配置</span>
            </li>
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span>上次同步</span>
              <span className="text-faint">从未</span>
            </li>
          </ul>
          <PlaceholderNote className="mt-3">
            同步会调用 librime 的 sync_user_data()。M0 仅展示状态，暂不提供触发入口。
          </PlaceholderNote>
        </Card>
      </div>
    </div>
  );
}
