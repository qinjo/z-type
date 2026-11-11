import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { ipc } from "@/lib/ipc";
import { useIpcQuery } from "@/lib/useIpcQuery";

interface SchemaRow {
  id: string;
  name: string;
  enabled: boolean;
  default: boolean;
}

export function Schemas() {
  const { data, loading } = useIpcQuery(() => ipc.scanProfile());
  const [rows, setRows] = useState<SchemaRow[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  const schemas: SchemaRow[] =
    rows ??
    (data?.schemas.map((schema) => ({
      ...schema,
      default: schema.id === data.default_schema,
    })) ??
      []);

  const activeDefault = defaultId ?? data?.default_schema ?? "";

  function toggle(id: string, enabled: boolean) {
    setRows(schemas.map((row) => (row.id === id ? { ...row, enabled } : row)));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="方案与启用"
        description="管理 schema_list、默认方案与每个方案的启用状态；变更会写回 default.custom.yaml，重建后生效。"
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Icon name="folder" size={14} />
              导入方案
            </Button>
            <Button size="sm" variant="primary">
              <Icon name="deploy" size={14} />
              应用并部署
            </Button>
          </>
        }
      />

      <Card
        title="方案列表"
        description={
          loading
            ? "扫描中…"
            : `共 ${schemas.length} 个方案 · 启用 ${schemas.filter((row) => row.enabled).length} 个`
        }
        flush
      >
        <table className="w-full text-left text-xs">
          <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
            <tr>
              <th className="w-10 px-4 py-2.5 font-medium">默认</th>
              <th className="px-4 py-2.5 font-medium">方案</th>
              <th className="px-4 py-2.5 font-medium">标识</th>
              <th className="px-4 py-2.5 font-medium">来源</th>
              <th className="w-20 px-4 py-2.5 text-right font-medium">启用</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {schemas.map((row) => (
              <tr key={row.id} className="group hover:bg-raised/40">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    aria-label={`将 ${row.name} 设为默认方案`}
                    onClick={() => setDefaultId(row.id)}
                    className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors ${
                      activeDefault === row.id
                        ? "border-accent bg-accent/20 text-accent"
                        : "border-line text-transparent hover:border-muted"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  </button>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text">{row.name}</span>
                    {activeDefault === row.id && <Badge tone="accent">默认</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-faint">{row.id}</td>
                <td className="px-4 py-3 text-muted">
                  {row.id.startsWith("double") ? "共享目录 · 双拼" : "用户目录 · *.schema.yaml"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Switch
                    checked={row.enabled}
                    onChange={(next) => toggle(row.id, next)}
                    label={`启用 ${row.name}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card title="写入策略" description="预览将要发生的文件变更">
          <ul className="space-y-2 text-xs text-muted">
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span className="font-mono text-2xs">default.custom.yaml</span>
              <Badge tone="warn">patch: schema_list</Badge>
            </li>
            <li className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2">
              <span className="font-mono text-2xs">default.custom.yaml</span>
              <Badge tone="warn">patch: menu.page_size</Badge>
            </li>
          </ul>
          <PlaceholderNote className="mt-3">
            实际写入走 <code className="font-mono text-2xs">write_gui_config</code> 命令；当前按钮为展示状态。
          </PlaceholderNote>
        </Card>

        <Card title="方案仓库" description="从共享目录安装的方案无法在此删除">
          <ul className="space-y-2 text-xs">
            {["雾凇拼音 rime-ice", "小鹤双拼 double_pinyin_flypy", "朙月拼音 luna_pinyin"].map((name) => (
              <li key={name} className="flex items-center gap-2 text-muted">
                <Icon name="check" size={13} className="text-ok" />
                <span>{name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-2xs leading-5 text-faint">
            缺失依赖：librime-lua、opencc 数据。体检页会给出修复建议。
          </p>
        </Card>
      </div>
    </div>
  );
}
