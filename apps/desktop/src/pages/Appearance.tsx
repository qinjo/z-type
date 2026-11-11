import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Field } from "@/components/Field";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { themePresets } from "@/lib/demo-data";
import { cn } from "@/lib/cn";

export function Appearance() {
  const [selected, setSelected] = useState(
    themePresets.find((theme) => theme.active)?.id ?? themePresets[0]?.id ?? "",
  );
  const [compact, setCompact] = useState(true);
  const activeTheme = themePresets.find((theme) => theme.id === selected) ?? themePresets[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="外观主题"
        description="选择候选窗配色、字体与布局。所有改动写入 squirrel.custom.yaml（macOS）/ weasel.custom.yaml（Windows）。"
        actions={
          <Button size="sm" variant="primary">
            保存并部署
          </Button>
        }
      />

      <div className="grid grid-cols-[1.25fr_1fr] gap-4">
        <Card title="主题预设" description="点击卡片切换；支持从共享目录导入自定义主题">
          <div className="grid grid-cols-2 gap-3">
            {themePresets.map((theme) => {
              const isActive = theme.id === selected;
              return (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setSelected(theme.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    isActive
                      ? "border-accent/60 bg-accent/5"
                      : "border-line bg-base/30 hover:border-line/80 hover:bg-raised/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-text">{theme.name}</span>
                    {isActive && <Badge tone="accent">使用中</Badge>}
                  </div>
                  <p className="mt-1 h-8 text-2xs leading-4 text-faint">{theme.description}</p>
                  <div className="mt-2 flex gap-1">
                    {theme.colors.map((color) => (
                      <span
                        key={color}
                        className="h-4 flex-1 rounded-sm border border-black/30"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          <PlaceholderNote className="mt-3">
            素笺为浅色主题占位；M0 只提供深色皮肤，切换仅改变预览，不会写入配置文件。
          </PlaceholderNote>
        </Card>

        <Card title="候选窗预览" description={`${activeTheme?.name ?? "—"} · 静态示意`}>
          <div className="rounded-md border border-line bg-[#12161c] p-3 font-sans shadow-inner">
            <div className="rounded border border-[#2b3442] bg-[#1a2029] px-3 py-2 shadow-lg">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-[#8b95a5]">ni hao</span>
                <span className="text-[15px] text-[#e6eaf1]">你好</span>
              </div>
              <div className="mt-1.5 flex gap-3 text-[13px] text-[#98a3b3]">
                <span className="text-[#6ea8fe]">1 你好</span>
                <span>2 拟好</span>
                <span>3 你</span>
                <span>4 尼</span>
                <span>5 泥</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between border-t border-[#2b3442] pt-1.5 text-2xs text-[#687385]">
                <span>雾凇拼音 · 小鹤双拼</span>
                <span>1/3 ›</span>
              </div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-2xs">
            <div>
              <dt className="text-faint">候选文字大小</dt>
              <dd className="tabular text-text">16 px</dd>
            </div>
            <div>
              <dt className="text-faint">圆角</dt>
              <dd className="tabular text-text">6 px</dd>
            </div>
            <div>
              <dt className="text-faint">横向候选数</dt>
              <dd className="tabular text-text">5</dd>
            </div>
            <div>
              <dt className="text-faint">竖排</dt>
              <dd className="text-text">关闭</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="字体" description="字体缺失时由系统回退，预览可能略有差异">
          <Field label="字体家族" hint="Squirrel 使用 font_face；Windows 使用 weasel 的 font_face">
            <select
              className="h-8 w-44 rounded-md border border-line bg-raised px-2 text-xs text-text"
              defaultValue="PingFang SC"
            >
              <option>PingFang SC</option>
              <option>Noto Sans CJK SC</option>
              <option>Microsoft YaHei</option>
              <option>自定义…</option>
            </select>
          </Field>
          <Field label="字号" hint="建议 14–18 px，高分屏可适当放大">
            <div className="flex h-8 items-center gap-0 overflow-hidden rounded-md border border-line bg-raised">
              <button
                type="button"
                className="h-full w-7 text-muted hover:bg-line/60"
                aria-label="减小字号"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-xs tabular text-text">16</span>
              <button
                type="button"
                className="h-full w-7 text-muted hover:bg-line/60"
                aria-label="增大字号"
              >
                +
              </button>
            </div>
          </Field>
          <Field label="状态栏" hint="展示方案名与页码">
            <Switch checked label="显示状态栏" onChange={() => undefined} />
          </Field>
        </Card>

        <Card title="布局" description="候选窗与输入区域的相对位置">
          <Field label="候选排列" hint="紧凑模式减少内边距">
            <Switch checked={compact} onChange={setCompact} label="紧凑排列" />
          </Field>
          <Field label="跟随光标" hint="多屏/缩放场景下可能偏移">
            <Switch checked onChange={() => undefined} label="跟随光标" />
          </Field>
          <Field label="显示序号" hint="1–5 的数字前缀">
            <Switch checked={false} onChange={() => undefined} label="显示序号" />
          </Field>
        </Card>
      </div>
    </div>
  );
}
