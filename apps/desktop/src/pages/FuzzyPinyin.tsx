import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { PlaceholderNote } from "@/components/PlaceholderNote";
import { Switch } from "@/components/Switch";
import { fuzzyGroups } from "@/lib/demo-data";

const samplePatch = `patch:
  "speller/algebra":
    - derive/^zh/z/
    - derive/^ch/c/
    - derive/^sh/s/
    - derive/(?<=[a-z])ang$/$1an/`;

export function FuzzyPinyin() {
  const [groups, setGroups] = useState(fuzzyGroups);
  const enabledCount = groups.reduce(
    (total, group) => total + group.pairs.filter((pair) => pair.enabled).length,
    0,
  );

  function toggle(groupId: string, pairId: string, enabled: boolean) {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              pairs: group.pairs.map((pair) =>
                pair.id === pairId ? { ...pair, enabled } : pair,
              ),
            }
          : group,
      ),
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="模糊音"
        description="为常见的平翘舌、前后鼻音、n/l 混淆建立容错。模糊音会显著增加重码，建议按需开启。"
        actions={
          <>
            <Badge tone={enabledCount > 0 ? "accent" : "neutral"}>
              已启用 {enabledCount} 组
            </Badge>
            <Button size="sm" variant="primary">
              应用模糊音
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-[1.5fr_1fr] gap-4">
        <div className="space-y-4">
          {groups.map((group) => (
            <Card
              key={group.id}
              title={group.title}
              description={group.description}
              actions={
                <Badge tone="neutral">
                  {group.pairs.filter((pair) => pair.enabled).length}/{group.pairs.length}
                </Badge>
              }
            >
              <div className="grid grid-cols-3 gap-2">
                {group.pairs.map((pair) => (
                  <div
                    key={pair.id}
                    className={`flex items-center justify-between rounded-md border px-2.5 py-2 transition-colors ${
                      pair.enabled
                        ? "border-accent/40 bg-accent/5"
                        : "border-line bg-base/30"
                    }`}
                  >
                    <span className="font-mono text-2xs">
                      <span className="text-text">{pair.from}</span>
                      <span className="mx-1 text-faint">≈</span>
                      <span className="text-text">{pair.to}</span>
                    </span>
                    <Switch
                      checked={pair.enabled}
                      onChange={(next) => toggle(group.id, pair.id, next)}
                      label={`${pair.from} 与 ${pair.to} 模糊`}
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card title="补丁预览" description="将写入的方案 *.custom.yaml">
            <pre className="overflow-x-auto rounded-md border border-line-soft bg-base/50 p-3 font-mono text-2xs leading-5 text-muted">
              {samplePatch}
            </pre>
            <PlaceholderNote className="mt-3">
              预览为固定示例；实际内容会根据上方开关生成 derive 规则并合并到现有 patch。
            </PlaceholderNote>
          </Card>

          <Card title="效果提示">
            <ul className="space-y-2 text-xs leading-5 text-muted">
              <li className="flex gap-2">
                <span className="text-warn">•</span>
                模糊音会让候选数量上升，长句输入建议关闭。
              </li>
              <li className="flex gap-2">
                <span className="text-warn">•</span>
                与双拼方案叠加时，部分规则可能重复，部署日志会提示。
              </li>
              <li className="flex gap-2">
                <span className="text-warn">•</span>
                修改后需要重新部署才能真正生效。
              </li>
            </ul>
            <Button size="sm" variant="ghost" className="mt-3">
              查看 Rime 官方说明
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
