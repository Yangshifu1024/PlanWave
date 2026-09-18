import type { ReactNode } from "react";

/**
 * 令牌化的原生下拉选择：用于 HeroUI Select 需要额外 ListBox 样板、
 * 且原生选择器体验更好的场景（如重复规则档位 / 单位）。
 */
export function NativeSelect({
  value,
  onChange,
  testId,
  ariaLabel,
  children,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      aria-label={ariaLabel}
      className={`rounded-xl border border-pw-border bg-pw-surface px-3 py-2 text-sm text-fg [color-scheme:light] dark:[color-scheme:dark] ${className}`}
    >
      {children}
    </select>
  );
}
