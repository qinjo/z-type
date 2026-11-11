import { alphaOf, normalizeHex, rgbHex, withAlpha, withRgb } from "@/lib/theme";
import { cn } from "@/lib/cn";

interface ColorFieldProps {
  /** 中文槽位名，例如「高亮候选背景」。 */
  label: string;
  /** Rime / 契约里的槽位键，例如 `hilited_candidate_back`。 */
  slot: string;
  value: string;
  invalid?: boolean;
  onChange: (value: string) => void;
}

/**
 * 主题颜色槽编辑器：颜色选择器负责 RGB，下方文本输入负责精确 hex
 * （支持 8 位 `#RRGGBBAA`），Alpha 数字输入方便快速调节透明度。
 * 非法值只标红、不阻塞输入，提交前由 `validateTheme` 统一拦截。
 */
export function ColorField({ label, slot, value, invalid = false, onChange }: ColorFieldProps) {
  const valid = normalizeHex(value) !== null;

  return (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 transition-colors",
        invalid || !valid
          ? "border-danger/45 bg-danger/5"
          : "border-line bg-base/30 hover:border-line/80",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs text-text" title={label}>
            {label}
          </p>
          <p className="truncate font-mono text-2xs text-faint" title={slot}>
            {slot}
          </p>
        </div>
        <input
          type="color"
          aria-label={`${label} 颜色选择器`}
          title={value}
          value={rgbHex(value)}
          onChange={(event) => onChange(withRgb(value, event.target.value))}
          className="h-6 w-8 shrink-0 cursor-pointer rounded border border-line bg-transparent p-0"
        />
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          aria-label={`${label} hex 值`}
          aria-invalid={!valid}
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-7 min-w-0 flex-1 rounded border border-line bg-raised px-1.5 font-mono text-2xs text-text outline-none focus:border-accent/60"
        />
        <label className="flex shrink-0 items-center gap-1 rounded border border-line bg-raised pl-1 focus-within:border-accent/60">
          <span className="text-2xs text-faint">A</span>
          <input
            type="number"
            aria-label={`${label} 透明度 0 到 255`}
            title="Alpha：0 = 全透明，255 = 不透明"
            min={0}
            max={255}
            value={alphaOf(value)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(parsed)) onChange(withAlpha(value, parsed));
            }}
            className="h-7 w-11 bg-transparent pr-1 text-right font-mono text-2xs tabular text-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
        </label>
      </div>
    </div>
  );
}
