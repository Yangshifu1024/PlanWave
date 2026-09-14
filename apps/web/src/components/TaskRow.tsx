import { Button, Checkbox, Chip } from "@heroui/react";
import type { ProjectRecord, TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { dueLabel } from "../lib/dates";

const PRIORITY_STYLE: Record<number, { dot: string; label: string }> = {
  3: { dot: "bg-red-500", label: "高" },
  2: { dot: "bg-orange-400", label: "中" },
  1: { dot: "bg-yellow-400", label: "低" },
};

const REPEAT_ICON = (
  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" aria-hidden>
    <path
      d="M13 6.5A5 5 0 0 0 3.8 4.6M3 9.5a5 5 0 0 0 9.2 1.9M3.2 2.2v2.6h2.6M12.8 13.8v-2.6h-2.6"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function TaskRow(props: {
  task: TaskRecord;
  showProject: boolean;
  projects: ProjectRecord[];
  /** 子任务进度（父任务行角标）。 */
  progress?: { done: number; total: number };
  /** undefined = 无子任务不显示箭头；true/false = 折叠状态。 */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** 子任务行：缩进展示。 */
  isSubtask?: boolean;
  /** 顶层存活任务显示内嵌发丝分隔线（悬停/选中时隐藏）。 */
  showDivider?: boolean;
  /** 回收站多选：选中态与切换回调（仅墓碑行使用）。 */
  trashSelected?: boolean;
  onToggleTrashSelect?: () => void;
}) {
  const {
    task,
    showProject,
    projects,
    progress,
    collapsed,
    onToggleCollapse,
    isSubtask,
    showDivider,
    trashSelected,
    onToggleTrashSelect,
  } = props;
  const selected = useApp((s) => s.selectedTaskId === task.id);
  const due = task.due_date !== null ? dueLabel(task.due_date) : null;
  const priority = PRIORITY_STYLE[task.priority];
  const projectName =
    showProject && task.project_id
      ? projects.find((p) => p.id === task.project_id)?.name
      : undefined;

  return (
    <div
      className={`group relative flex cursor-default items-center gap-3 rounded-xl px-3 py-2 transition ${
        selected ? "bg-blue-50 dark:bg-blue-500/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      } ${isSubtask ? "ml-9" : ""} ${
        showDivider
          ? "before:pointer-events-none before:absolute before:bottom-0 before:left-11 before:right-3 before:h-px before:bg-zinc-200/70 before:transition-opacity group-hover:before:opacity-0 dark:before:bg-zinc-800"
          : ""
      } ${selected ? "before:opacity-0" : ""}`}
      onClick={() => actions.selectTask(task.id)}
      data-testid="task-row"
      data-task-title={task.title}
    >
      {/* 阻止勾选冒泡到行（避免打开详情）。
          墓碑行（回收站）行首是多选框——完成勾选对已删任务无意义 */}
      <span onClick={(e) => e.stopPropagation()}>
        {task.deleted ? (
          <Checkbox
            isSelected={trashSelected ?? false}
            onChange={() => onToggleTrashSelect?.()}
            data-testid={`trash-check-${task.title}`}
            aria-label={trashSelected ? "取消选择" : "选择任务"}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
        ) : (
          <Checkbox
            isSelected={task.completed}
            onChange={() => void actions.toggleTaskWithUndo(task.id)}
            data-testid={`check-${task.title}`}
            aria-label={task.completed ? "标记未完成" : "标记完成"}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
            </Checkbox.Content>
          </Checkbox>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <span
          className={`block truncate ${isSubtask ? "text-[13px]" : "text-sm"} ${
            task.completed || task.deleted
              ? "text-zinc-400 line-through"
              : isSubtask
                ? "text-zinc-500 dark:text-zinc-400"
                : ""
          }`}
        >
          {task.title}
        </span>
        {(projectName ||
          (task.labels.length > 0 && !task.completed) ||
          (task.recurrence && !task.completed)) && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            {projectName && <span>{projectName}</span>}
            {task.recurrence && !task.completed && (
              <span className="flex items-center gap-0.5" title="重复任务">
                {REPEAT_ICON}
              </span>
            )}
            {task.labels.map((l) => (
              <Chip key={l} size="sm" variant="soft">
                {l}
              </Chip>
            ))}
          </span>
        )}
      </div>

      {progress && progress.total > 0 && (
        <button
          className="flex shrink-0 cursor-pointer items-center text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          title={collapsed ? "展开子任务" : "折叠子任务"}
          data-testid={`subtask-toggle-${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
        >
          <svg
            viewBox="0 0 12 12"
            className={`mr-0.5 size-3 transition-transform ${collapsed ? "" : "rotate-90"}`}
            fill="none"
            aria-hidden
          >
            <path
              d="M4 2.5L8 6l-4 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {progress.done}/{progress.total}
        </button>
      )}

      {priority && !task.completed && (
        <span
          className={`size-2 shrink-0 rounded-full ${priority.dot}`}
          title={`优先级：${priority.label}`}
        />
      )}

      {due && !task.completed && (
        <span
          className={`shrink-0 text-xs ${
            due.tone === "overdue"
              ? "text-red-500"
              : due.tone === "today"
                ? "text-blue-500"
                : "text-zinc-400"
          }`}
        >
          {due.text}
        </span>
      )}

      {task.deleted ? (
        <>
          <Button
            size="sm"
            onPress={() => void actions.restoreTask(task.id)}
            data-testid={`restore-${task.title}`}
            className="shrink-0 opacity-0 transition group-hover:opacity-100"
          >
            恢复
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => actions.openPurgeConfirm([task.id])}
            data-testid={`purge-${task.title}`}
            aria-label="彻底删除"
            className="shrink-0 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
          >
            彻底删除
          </Button>
        </>
      ) : (
        <Button
          isIconOnly
          variant="ghost"
          onPress={() =>
            actions.requestConfirm({
              title: "删除任务",
              message: `将「${task.title}」移到回收站？可在回收站中恢复。`,
              confirmLabel: "移到回收站",
              action: () => actions.deleteTask(task.id),
            })
          }
          aria-label="移到回收站"
          className="shrink-0 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden>
            <path
              d="M3 4.5h10M6.5 4.5V3.8c0-.4.3-.8.8-.8h1.4c.5 0 .8.4.8.8v.7M5 4.5l.5 8c0 .6.5 1 1 1h3c.5 0 1-.4 1-1l.5-8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </Button>
      )}
    </div>
  );
}
