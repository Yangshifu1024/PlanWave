import { Button, Checkbox, Chip } from "@heroui/react";
import type { ProjectRecord, TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { dueLabel } from "../lib/dates";

const PRIORITY_STYLE: Record<number, { dot: string; label: string }> = {
  3: { dot: "bg-red-500", label: "高" },
  2: { dot: "bg-orange-400", label: "中" },
  1: { dot: "bg-yellow-400", label: "低" },
};

export function TaskRow(props: {
  task: TaskRecord;
  showProject: boolean;
  projects: ProjectRecord[];
}) {
  const { task, showProject, projects } = props;
  const selected = useApp((s) => s.selectedTaskId === task.id);
  const due = task.due_date !== null ? dueLabel(task.due_date) : null;
  const priority = PRIORITY_STYLE[task.priority];
  const projectName =
    showProject && task.project_id
      ? projects.find((p) => p.id === task.project_id)?.name
      : undefined;

  return (
    <li
      className={`group flex cursor-default items-center gap-3 rounded-xl px-3 py-2 transition ${
        selected ? "bg-blue-50 dark:bg-blue-500/10" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
      onClick={() => actions.selectTask(task.id)}
      data-testid="task-row"
      data-task-title={task.title}
    >
      {/* 阻止勾选冒泡到行（避免打开详情） */}
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          isSelected={task.completed}
          onChange={() => void actions.toggleTask(task.id)}
          data-testid={`check-${task.title}`}
          aria-label={task.completed ? "标记未完成" : "标记完成"}
        >
          <Checkbox.Content>
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
          </Checkbox.Content>
        </Checkbox>
      </span>

      <div className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm ${
            task.completed ? "text-zinc-400 line-through" : ""
          }`}
        >
          {task.title}
        </span>
        {(projectName || (task.labels.length > 0 && !task.completed)) && (
          <span className="flex items-center gap-1.5 text-xs text-zinc-400">
            {projectName && <span>{projectName}</span>}
            {task.labels.map((l) => (
              <Chip key={l} size="sm" variant="soft">
                {l}
              </Chip>
            ))}
          </span>
        )}
      </div>

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
        <Button
          size="sm"
          onPress={() => void actions.restoreTask(task.id)}
          data-testid={`restore-${task.title}`}
          className="shrink-0 opacity-0 transition group-hover:opacity-100"
        >
          恢复
        </Button>
      ) : (
        <Button
          isIconOnly
          variant="ghost"
          onPress={() => void actions.deleteTask(task.id)}
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
    </li>
  );
}
