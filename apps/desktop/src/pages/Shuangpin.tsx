import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { shuangpinSchemes } from "@/lib/demo-data";

const keyRows = [
  { key: "Q", value: "iu" },
  { key: "W", value: "ei" },
  { key: "E", value: "e" },
  { key: "R", value: "uan" },
  { key: "T", value: "ue" },
  { key: "Y", value: "un" },
  { key: "U", value: "sh" },
  { key: "I", value: "ch" },
  { key: "O", value: "o" },
  { key: "P", value: "ie" },
];

export function Shuangpin() {
  const [selected, setSelected] = useState(
    shuangpinSchemes.find((scheme) => scheme.active)?.id ?? shuangpinSchemes[0]?.id ?? "",
  );
  const scheme = shuangpinSchemes.find((item) => item.id === selected) ?? shuangpinSchemes[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="双拼"
        description="选择双拼方案或编辑自定义键位映射。双拼与全拼方案不应同时作为默认方案。"
        actions={
          <Button size="sm" variant="primary">
            应用双拼方案
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card title="双拼方案" description="共享目录中检测到的双拼方案">
          <div className="space-y-2">
            {shuangpinSchemes.map((item) => {
              const isActive = item.id === selected;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item.id)}
                  className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                    isActive
                      ? "border-accent/60 bg-accent/5"
                      : "border-line bg-base/30 hover:bg-raised/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-text">{item.name}</span>
                    {isActive && <Badge tone="accent">当前</Badge>}
                  </div>
                  <p className="mt-0.5 text-2xs text-faint">{item.description}</p>
                </button>
              );
            })}
          </div>
          <PlaceholderNote className="mt-3">
            方案列表来自 scan_profile()；未安装的方案会显示为「可安装」。
          </PlaceholderNote>
        </Card>

        <Card title="键位布局" description={`${scheme?.name ?? "—"} · 韵母映射`}>
          <div className="grid grid-cols-5 gap-1.5">
            {keyRows.map((row) => (
              <div
                key={row.key}
                className="rounded border border-line bg-raised/60 px-2 py-1.5 text-center"
              >
                <div className="font-mono text-xs text-text">{row.key}</div>
                <div className="font-mono text-2xs text-faint">{row.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded border border-line-soft bg-base/40 px-3 py-2 text-xs">
            <span className="text-faint">编码示例：</span>
            <span className="ml-2 font-mono text-text">nihc</span>
            <span className="mx-1.5 text-faint">→</span>
            <span className="text-text">你好</span>
          </div>
          <p className="mt-3 text-2xs leading-5 text-faint">
            双拼只需两次击键完成一个音节；零声母用分号或首字母键占位，具体取决于方案。
          </p>
        </Card>
      </div>

      <Card title="自定义映射" description="覆盖方案内置的韵母表（写入该方案的 *.custom.yaml）">
        <div className="grid grid-cols-4 gap-2">
          {[
            { final: "iao", key: "N" },
            { final: "iang", key: "L" },
            { final: "iong", key: "S" },
            { final: "ua", key: "M" },
          ].map((row) => (
            <div
              key={row.final}
              className="flex items-center justify-between rounded border border-line-soft bg-base/40 px-2.5 py-2"
            >
              <span className="font-mono text-2xs text-muted">{row.final}</span>
              <span className="text-faint">→</span>
              <span className="font-mono text-xs text-text">{row.key}</span>
            </div>
          ))}
        </div>
        <PlaceholderNote className="mt-3">
          M0 只读展示。后续会提供按键录制与冲突检测，并提示哪些映射被方案默认值占用。
        </PlaceholderNote>
      </Card>
    </div>
  );
}
