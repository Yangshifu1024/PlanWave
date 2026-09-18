import type { ProjectRecord, TaskRecord } from "../types";
import type { TaskDrag } from "../lib/useTaskDrag";
import { projectDotClass } from "../lib/projectColors";

/**
 * 桌面「未排期」抽屉（lg 及以上）：无截止日的顶层任务，可拖入网格排期，
 * 也可把网格里的任务拖回此处以清除日期（`data-drop-key=""`）。
 * compact/平板改用 MonthView 内的「未排期」入口 + 底部浮层。
 */
export function UnscheduledTray(props: {
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  drag: TaskDrag;
  open: boolean;
  onToggle: () => void;
}) {
  const { tasks, projects, drag, open, onToggle } = props;
  const colorOf = (projectId: string) =>
    projectDotClass(projects.find((p) => p.id === projectId)?.color ?? "gray");

  if (!open) {
    return (
      <aside className="hidden shrink-0 lg:flex" data-testid="unscheduled-tray">
        <button
          type="button"
          onClick={onToggle}
          data-testid="unscheduled-toggle"
          className="flex cursor-pointer items-start rounded-xl border border-pw-border bg-pw-surface-2 px-1.5 py-2 text-xs text-fg-subtle transition hover:text-fg"
        >
          <span className="[writing-mode:vertical-rl]">
            未排期{tasks.length > 0 ? ` (${tasks.length})` : ""}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="hidden shrink-0 lg:flex" data-testid="unscheduled-tray">
      <div
        data-drop-key=""
        className={`flex w-60 flex-col rounded-xl border border-pw-border bg-pw-surface-2 transition ${
          drag.overKey === "" ? "ring-2 ring-blue-400" : ""
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          data-testid="unscheduled-toggle"
          className="flex cursor-pointer items-center justify-between border-b border-pw-border px-3 py-2 text-xs font-medium text-fg-muted transition hover:text-fg"
        >
          <span>未排期{tasks.length > 0 ? ` (${tasks.length})` : ""}</span>
          <span aria-hidden>›</span>
        </button>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          {tasks.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-fg-subtle">没有未排期的任务</p>
          ) : (
            tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                title={t.title}
                data-testid={`unscheduled-chip-${t.title}`}
                data-task-title={t.title}
                {...drag.chipProps(t)}
                className={`flex w-full cursor-grab items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-fg transition hover:bg-pw-hover ${
                  drag.draggingId === t.id ? "opacity-60 shadow-lg" : ""
                }`}
              >
                <span className={`size-1.5 shrink-0 rounded-full ${colorOf(t.project_id)}`} />
                <span className="truncate">{t.title}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
