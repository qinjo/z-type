import { cn } from "@/lib/cn";

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}

/** 整数数字输入：值始终被夹在 [min, max] 之间，避免把负数发给 Rust 的 u16。 */
export function NumberInput({
  value,
  onChange,
  ariaLabel,
  min = 0,
  max = 999,
  step = 1,
  suffix,
  disabled = false,
  className,
}: NumberInputProps) {
  function update(raw: string) {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(max, Math.max(min, Math.round(parsed))));
  }

  return (
    <div
      className={cn(
        "flex h-8 items-center overflow-hidden rounded-md border border-line bg-raised transition-colors focus-within:border-accent/60",
        className,
      )}
    >
      <input
        type="number"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => update(event.target.value)}
        className="h-full w-16 bg-transparent px-2 text-right font-mono text-xs tabular text-text outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="pr-2 text-2xs text-faint">{suffix}</span>}
    </div>
  );
}
