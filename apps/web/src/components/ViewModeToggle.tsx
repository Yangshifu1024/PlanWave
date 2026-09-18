import { actions, useApp, type ViewMode } from "../state/store";

const MODES: { value: ViewMode; label: string }[] = [
  { value: "list", label: "列表" },
  { value: "month", label: "月" },
];

/** 「列表 / 月」呈现切换器（仅「全部」与项目视图渲染）。 */
export function ViewModeToggle() {
  const viewMode = useApp((s) => s.viewMode);
  return (
    <div
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-pw-surface-2 p-0.5 ring-1 ring-pw-border"
      data-testid="view-mode-toggle"
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          data-testid={`view-mode-${m.value}`}
          aria-pressed={viewMode === m.value}
          onClick={() => actions.setViewMode(m.value)}
          className={`rounded-md px-2.5 py-1 text-xs transition ${
            viewMode === m.value
              ? "bg-pw-surface font-medium text-fg shadow-sm"
              : "text-fg-subtle hover:text-fg"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
