import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { advancedToggles, configPaths } from "@/lib/demo-data";
import { ipc } from "@/lib/ipc";
import { useIpcQuery } from "@/lib/useIpcQuery";

export function Advanced() {
  const [toggles, setToggles] = useState(advancedToggles);
  const config = useIpcQuery(() => ipc.readFile("~/Library/Rime/default.custom.yaml"));

  function toggle(id: string, enabled: boolean) {
    setToggles((current) =>
      current.map((item) => (item.id === id ? { ...item, enabled } : item)),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="高级"
        description="路径、原始配置与危险操作的集中入口。这里的改动影响面较大，建议先创建快照。"
        actions={
          <Button size="sm" variant="primary">
            保存全部设置
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card title="配置路径" description="点击复制路径；缺失的目录会标注为不可用" flush>
          <ul className="divide-y divide-line-soft">
            {configPaths.map((path) => (
              <li key={path.id} className="flex items-start gap-3 px-4 py-2.5">
                <span className="mt-0.5 text-faint">
                  <Icon name="folder" size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text">{path.label}</span>
                    <Badge tone={path.exists ? "neutral" : "warn"}>
                      {path.exists ? path.kind : "不存在"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-2xs text-faint" title={path.path}>
                    {path.path}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="shrink-0">
                  复制
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="行为开关" description="保存后立即写入 rime-studio 的本地配置">
          {toggles.map((item) => (
            <Field key={item.id} label={item.label} hint={item.hint}>
              <Switch
                checked={item.enabled}
                onChange={(next) => toggle(item.id, next)}
                label={item.label}
              />
            </Field>
          ))}
        </Card>
      </div>

      <Card
        title="原始配置"
        description="default.custom.yaml · 只读预览（来自 read_file）"
        actions={
          <Button size="sm" variant="ghost">
            <Icon name="external" size={14} />
            在编辑器中打开
          </Button>
        }
      >
        <pre className="max-h-56 overflow-auto rounded-md border border-line-soft bg-base/50 p-3 font-mono text-2xs leading-5 text-muted">
          {config.loading ? "读取中…" : config.error ? `读取失败：${config.error}` : config.data?.content}
        </pre>
        <PlaceholderNote className="mt-3">
          后续版本提供带 YAML 语法高亮与校验的编辑器。M0 阶段禁止直接写回，避免破坏用户配置。
        </PlaceholderNote>
      </Card>

      <Card title="危险操作" className="border-danger/25">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border border-line-soft bg-base/30 p-3">
            <p className="text-xs text-text">重建构建目录</p>
            <p className="mt-1 text-2xs leading-5 text-faint">删除 build/ 后重新部署，耗时约 10s</p>
            <Button size="sm" variant="secondary" className="mt-3">
              重建
            </Button>
          </div>
          <div className="rounded-md border border-line-soft bg-base/30 p-3">
            <p className="text-xs text-text">清除 GUI 配置</p>
            <p className="mt-1 text-2xs leading-5 text-faint">重置本工作台记录，不影响 Rime</p>
            <Button size="sm" variant="secondary" className="mt-3">
              清除
            </Button>
          </div>
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
            <p className="text-xs text-danger">恢复上一次快照</p>
            <p className="mt-1 text-2xs leading-5 text-faint">会覆盖当前 custom.yaml，不可撤销</p>
            <Button size="sm" variant="danger" className="mt-3">
              恢复快照
            </Button>
          </div>
        </div>
        <p className="mt-3 text-2xs leading-5 text-faint">
          以上按钮在 M0 阶段均为占位，不会执行任何文件操作。
        </p>
      </Card>
    </div>
  );
}
