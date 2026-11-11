import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { keyBindings } from "@/lib/demo-data";

const presets = [
  { id: "default", name: "默认", hint: "Squirrel / Weasel 惯用键位" },
  { id: "vim", name: "Vim 风格", hint: "用 j/k 翻页，Esc 退出" },
  { id: "minimal", name: "极简", hint: "仅保留上屏与翻页" },
];

export function KeyBindings() {
  const [preset, setPreset] = useState("default");
  const [showAscii, setShowAscii] = useState(true);
  const [globalDeploy, setGlobalDeploy] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        title="按键"
        description="配置中英切换、翻页、上屏等键位。改键会合并进 default.custom.yaml 的 key_binder 节点。"
        actions={
          <>
            <Button size="sm" variant="ghost">
              恢复默认
            </Button>
            <Button size="sm" variant="primary">
              保存键位
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[1fr_1.6fr] gap-4">
        <Card title="键位预设" description="预设之间可互相覆盖，冲突项会高亮">
          <div className="space-y-2">
            {presets.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                  preset === item.id
                    ? "border-accent/60 bg-accent/5"
                    : "border-line bg-base/30 hover:bg-raised/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-text">{item.name}</span>
                  {preset === item.id && <Badge tone="accent">选中</Badge>}
                </div>
                <p className="mt-0.5 text-2xs text-faint">{item.hint}</p>
              </button>
            ))}
          </div>
          <PlaceholderNote className="mt-3">
            预设只改变下方表格文案；真正的 key_binder 生成逻辑在 Rust 侧。
          </PlaceholderNote>
        </Card>

        <Card title="键位映射" description={`当前预设：${presets.find((p) => p.id === preset)?.name}`} flush>
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">动作</th>
                <th className="px-4 py-2.5 font-medium">按键</th>
                <th className="px-4 py-2.5 font-medium">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {keyBindings.map((binding) => (
                <tr key={binding.id} className="hover:bg-raised/40">
                  <td className="px-4 py-2.5 text-text">{binding.action}</td>
                  <td className="px-4 py-2.5">
                    <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-accent">
                      {binding.binding}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-faint">{binding.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="行为" description="影响按键处理时机">
          <Field label="禁用组合键穿透" hint="输入法消费后的按键不再传给应用">
            <Switch checked onChange={() => undefined} label="禁用组合键穿透" />
          </Field>
          <Field label="中英切换使用 Shift" hint="单独按下并释放时触发，组合键不受影响">
            <Switch checked={showAscii} onChange={setShowAscii} label="中英切换使用 Shift" />
          </Field>
          <Field label="全局部署快捷键" hint="注册到系统级，需要辅助功能权限">
            <Switch checked={globalDeploy} onChange={setGlobalDeploy} label="全局部署快捷键" />
          </Field>
          <Field label="按键防抖" hint="连续触发的最小间隔">
            <span className="font-mono text-xs tabular text-muted">120 ms</span>
          </Field>
        </Card>

        <Card title="自定义按键" description="M0 阶段仅展示结构">
          <div className="space-y-2">
            {[
              { action: "切换到下一个方案", keys: "Control+Shift+1" },
              { action: "打开方案选单", keys: "F4" },
              { action: "临时拼音", keys: "`" },
            ].map((row) => (
              <div
                key={row.keys}
                className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-3 py-2 text-xs"
              >
                <span className="text-muted">{row.action}</span>
                <code className="font-mono text-2xs text-text">{row.keys}</code>
              </div>
            ))}
          </div>
          <PlaceholderNote className="mt-3">
            后续版本支持可视化录制按键；当前为静态示例，避免误改用户配置。
          </PlaceholderNote>
        </Card>
      </div>
    </div>
  );
}
