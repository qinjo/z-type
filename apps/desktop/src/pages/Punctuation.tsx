import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { punctuationRows } from "@/lib/demo-data";

const presets = ["默认（中文标点）", "英文标点", "编程友好（半角优先）", "自定义"];

export function Punctuation() {
  const [preset, setPreset] = useState(presets[0]);
  const [fullWidthDigits, setFullWidthDigits] = useState(false);
  const [smartQuote, setSmartQuote] = useState(true);

  return (
    <div className="space-y-5">
      <PageHeader
        title="标点与符号"
        description="控制全角/半角转换与成对符号的自动闭合。改动作用于 punct 与 punctuation 相关节点。"
        actions={
          <Button size="sm" variant="primary">
            保存标点规则
          </Button>
        }
      />

      <div className="grid grid-cols-[1.6fr_1fr] gap-4">
        <Card
          title="标点映射"
          description={`共 ${punctuationRows.length} 条规则 · 当前预设：${preset}`}
          flush
        >
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line-soft bg-base/30 text-2xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">名称</th>
                <th className="px-4 py-2.5 font-medium">半角</th>
                <th className="px-4 py-2.5 font-medium">全角</th>
                <th className="px-4 py-2.5 font-medium">规则说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {punctuationRows.map((row) => (
                <tr key={row.id} className="hover:bg-raised/40">
                  <td className="px-4 py-2.5 text-text">{row.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-muted">
                      {row.half}
                    </code>
                  </td>
                  <td className="px-4 py-2.5">
                    <code className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-2xs text-accent">
                      {row.full}
                    </code>
                  </td>
                  <td className="px-4 py-2.5 text-faint">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title="预设" description="选择后可在下方微调">
            <div className="space-y-2">
              {presets.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPreset(item)}
                  className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                    preset === item
                      ? "border-accent/60 bg-accent/5 text-text"
                      : "border-line bg-base/30 text-muted hover:bg-raised/40"
                  }`}
                >
                  {item}
                  {preset === item && <Badge tone="accent">选中</Badge>}
                </button>
              ))}
            </div>
          </Card>

          <Card title="转换选项">
            <Field label="成对符号自动闭合" hint="输入左引号时自动补全右引号">
              <Switch checked={smartQuote} onChange={setSmartQuote} label="成对符号自动闭合" />
            </Field>
            <Field label="数字使用全角" hint="默认关闭，避免电话号码、金额显示异常">
              <Switch
                checked={fullWidthDigits}
                onChange={setFullWidthDigits}
                label="数字使用全角"
              />
            </Field>
            <Field label="网址与邮箱保持半角" hint="连续字母与点号会被识别">
              <Switch checked onChange={() => undefined} label="网址与邮箱保持半角" />
            </Field>
          </Card>
        </div>
      </div>

      <Card title="输入预览" description="在下方输入框里试打，验证规则是否符合预期（M0 为静态示意）">
        <div className="rounded-md border border-line bg-base/50 px-3 py-2.5">
          <p className="font-mono text-[13px] leading-6 text-muted">
            他说：“明天 9:30 见，地址是 https://rime.im。”
          </p>
        </div>
        <PlaceholderNote className="mt-3">
          预览使用固定文本。后端接入后，此区域会调用 librime 的 punctuation processor 做真实转换。
        </PlaceholderNote>
      </Card>
    </div>
  );
}
