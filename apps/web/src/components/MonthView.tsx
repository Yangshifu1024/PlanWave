import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import type { TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { startOfDay } from "../lib/dates";
import {
  MONTH_CELL_MAX,
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  dueForDay,
  dueTimeLabel,
  monthTitle,
  unscheduledTasks,
  type MonthDay,
} from "../lib/monthGrid";
import { projectDotClass } from "../lib/projectColors";
import { useIsNarrow } from "../lib/useNarrowViewport";
import { useTaskDrag } from "../lib/useTaskDrag";
import { PRIORITY_STYLE, REPEAT_ICON } from "./TaskRow";
import { QuickAddModal } from "./QuickAddModal";
import { DayTasksOverlay } from "./DayTasksOverlay";
import { UnscheduledTray } from "./UnscheduledTray";

/** 月视图：周一起始的固定 6 行网格 + 桌面「未排期」抽屉 + 拖拽改期。 */
export function MonthView() {
  const tasks = useApp((s) => s.tasks);
  const projects = useApp((s) => s.projects);
  const view = useApp((s) => s.view);
  const unscheduledOpen = useApp((s) => s.unscheduledOpen);
  const narrow = useIsNarrow();
  // 锚定「今天」：一次挂载内固定，避免每次渲染漂移
  const [now] = useState(() => new Date());
  const [anchor, setAnchor] = useState(() => ({ year: now.getFullYear(), month: now.getMonth() }));
  // 非空 = 打开新建弹框（标题 + 预填截止日期）
  const [pending, setPending] = useState<{ title: string; dueDate: number } | null>(null);
  const [overlayKey, setOverlayKey] = useState<string | null>(null);
  const [showCompleted] = useState(
    () => localStorage.getItem("planwave.ui.showCompleted") === "true",
  );

  const grid = useMemo(
    () => buildMonthGrid(tasks, view, anchor.year, anchor.month, { showCompleted, now }),
    [tasks, view, anchor, showCompleted, now],
  );
  const unscheduled = useMemo(() => unscheduledTasks(tasks, view, now), [tasks, view, now]);
  const todayStart = startOfDay(now).getTime();

  const drag = useTaskDrag({
    onTap: (id) => actions.selectTask(id),
    onDrop: (id, key) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      if (key === "") {
        void actions.rescheduleTaskWithUndo(id, null);
        return;
      }
      const day = grid.days.find((d) => d.key === key);
      if (!day) return;
      void actions.rescheduleTaskWithUndo(id, dueForDay(task, day.date));
    },
  });

  const overlayDay = overlayKey ? (grid.days.find((d) => d.key === overlayKey) ?? null) : null;

  const shiftMonth = (delta: number) => {
    const d = addMonths(new Date(anchor.year, anchor.month, 1), delta);
    setAnchor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const colorOf = (projectId: string) =>
    projectDotClass(projects.find((p) => p.id === projectId)?.color ?? "gray");

  const renderChip = (task: TaskRecord) => {
    const time = dueTimeLabel(task.due_date);
    const overdue =
      !task.completed &&
      task.due_date !== null &&
      startOfDay(new Date(task.due_date)).getTime() < todayStart;
    const priority = PRIORITY_STYLE[task.priority];
    return (
      <div
        key={task.id}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 transition hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 ${
          drag.draggingId === task.id ? "opacity-60 shadow-lg" : ""
        }`}
      >
        <button
          type="button"
          aria-label={task.completed ? "标记未完成" : "标记完成"}
          data-testid={`month-check-${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            void actions.toggleTaskWithUndo(task.id);
          }}
          className={`size-3 shrink-0 rounded-full border transition ${
            task.completed
              ? "border-blue-500 bg-blue-500"
              : "border-zinc-300 hover:border-blue-400 dark:border-zinc-600"
          }`}
        />
        <button
          type="button"
          title={task.title}
          data-testid={`month-chip-${task.title}`}
          data-task-title={task.title}
          {...drag.chipProps(task)}
          className={`flex min-w-0 flex-1 cursor-grab items-center gap-1 text-left text-[11px] leading-tight ${
            task.completed
              ? "text-zinc-400 line-through"
              : overdue
                ? "text-red-500"
                : "text-zinc-700 dark:text-zinc-200"
          }`}
        >
          {priority && <span className={`size-1.5 shrink-0 rounded-full ${priority.dot}`} />}
          <span className={`size-1.5 shrink-0 rounded-full ${colorOf(task.project_id)}`} />
          <span className="truncate">{task.title}</span>
          {task.recurrence && !task.completed && (
            <span className="shrink-0 text-zinc-400">{REPEAT_ICON}</span>
          )}
          {time && <span className="ml-auto shrink-0 text-[10px] text-zinc-400">{time}</span>}
        </button>
      </div>
    );
  };

  const renderCell = (day: MonthDay) => (
    <div
      key={day.key}
      data-testid={`month-day-${day.key}`}
      data-drop-key={day.key}
      onClick={() => {
        if (narrow) setOverlayKey(day.key);
        else setPending({ title: "", dueDate: day.date.getTime() });
      }}
      className={`flex min-h-[76px] cursor-pointer flex-col gap-0.5 border-b border-r border-zinc-200 p-1 transition sm:min-h-[96px] dark:border-zinc-800 ${
        day.inMonth ? "bg-white dark:bg-zinc-900" : "bg-zinc-50 dark:bg-zinc-900/40"
      } ${drag.overKey === day.key ? "ring-2 ring-inset ring-blue-400" : ""}`}
    >
      <div className="flex items-center justify-between px-0.5">
        <span
          className={`text-xs ${
            day.isToday
              ? "flex size-5 items-center justify-center rounded-full bg-blue-500 font-semibold text-white"
              : day.inMonth
                ? "text-zinc-500 dark:text-zinc-400"
                : "text-zinc-300 dark:text-zinc-600"
          }`}
        >
          {day.day}
        </span>
        {narrow && day.tasks.length > 0 && (
          <span className="text-[10px] text-zinc-400" data-testid={`month-day-count-${day.key}`}>
            {day.tasks.length}
          </span>
        )}
      </div>
      {narrow ? (
        <div className="flex flex-wrap gap-0.5 px-0.5">
          {day.tasks.slice(0, MONTH_CELL_MAX).map((t) => (
            <span key={t.id} className={`size-1.5 rounded-full ${colorOf(t.project_id)}`} />
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {day.tasks.slice(0, MONTH_CELL_MAX).map(renderChip)}
          {day.overflow > 0 && (
            <button
              type="button"
              data-testid={`month-more-${day.key}`}
              onClick={(e) => {
                e.stopPropagation();
                setOverlayKey(day.key);
              }}
              className="rounded px-1 text-left text-[11px] text-zinc-400 transition hover:text-blue-500"
            >
              +{day.overflow} 更多
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col ${drag.draggingId ? "select-none" : ""}`}
      data-testid="month-view"
    >
      <div className="flex items-center gap-2 px-4 pt-3 sm:px-6">
        <h2 className="text-base font-semibold" data-testid="month-title">
          {monthTitle(anchor.year, anchor.month)}
        </h2>
        <div className="ml-auto flex items-center gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="上个月"
            data-testid="month-prev"
            onPress={() => shiftMonth(-1)}
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
              <path
                d="M10 3.5 5.5 8l4.5 4.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="month-today"
            onPress={() => setAnchor({ year: now.getFullYear(), month: now.getMonth() })}
          >
            今天
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="下个月"
            data-testid="month-next"
            onPress={() => shiftMonth(1)}
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
              <path
                d="M6 3.5 10.5 8 6 12.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 pt-3 sm:px-6 sm:pb-4">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-7 overflow-hidden rounded-xl border-l border-t border-zinc-200 dark:border-zinc-800">
            {WEEKDAY_LABELS.map((w) => (
              <div
                key={w}
                className="border-b border-r border-zinc-200 bg-zinc-50 px-2 py-1 text-center text-xs font-medium text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60"
              >
                {w}
              </div>
            ))}
            {grid.days.map(renderCell)}
          </div>
        </div>
        <UnscheduledTray
          tasks={unscheduled}
          projects={projects}
          drag={drag}
          open={unscheduledOpen}
          onToggle={() => actions.toggleUnscheduled()}
        />
      </div>

      {overlayDay && (
        <DayTasksOverlay
          title={`${overlayDay.date.getMonth() + 1} 月 ${overlayDay.date.getDate()} 日`}
          tasks={overlayDay.tasks}
          projects={projects}
          onClose={() => setOverlayKey(null)}
          onAdd={() => setPending({ title: "", dueDate: overlayDay.date.getTime() })}
        />
      )}
      {pending && (
        <QuickAddModal
          title={pending.title}
          dueDate={pending.dueDate}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}
