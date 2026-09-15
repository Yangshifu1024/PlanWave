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
      className="flex shrink-0 items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800"
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
              ? "bg-white font-medium text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
