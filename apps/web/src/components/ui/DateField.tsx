/**
 * 令牌化的原生日期输入（全平台统一）。
 * 有意使用 `<input type="date">` 而非 HeroUI DatePicker：移动端系统日期面板优于网页日历。
 */
export function DateField({
  value,
  onChange,
  testId,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
      aria-label={ariaLabel}
      className="w-full rounded-xl border border-pw-border bg-pw-surface px-3 py-2 text-sm text-fg [color-scheme:light] dark:[color-scheme:dark]"
    />
  );
}
