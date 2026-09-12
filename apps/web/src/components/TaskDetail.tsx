import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Calendar,
  DatePicker,
  Input,
  ListBox,
  ListBoxItem,
  Select,
  Switch,
  TextArea,
} from "@heroui/react";
import type { TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { fromDateValue, toDateValue } from "../lib/dates";

const PRIORITIES: { value: number; label: string }[] = [
  { value: 0, label: "无" },
  { value: 1, label: "低" },
  { value: 2, label: "中" },
  { value: 3, label: "高" },
];

/** 右栏任务详情：桌面侧栏、移动端全屏覆盖。字段编辑防抖提交 oplog。 */
export function TaskDetail() {
  const tasks = useApp((s) => s.tasks);
  const projects = useApp((s) => s.projects);
  const selectedTaskId = useApp((s) => s.selectedTaskId);
  const detailOpen = useApp((s) => s.detailOpen);
  const task = tasks.find((t) => t.id === selectedTaskId) as TaskRecord | undefined;

  if (!task || !detailOpen) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-white dark:bg-zinc-900 md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-zinc-200 md:dark:border-zinc-800"
      data-testid="task-detail"
    >
      {task && (
        <DetailBody
          key={task.id}
          task={task}
          projects={projects.filter((p) => !p.deleted)}
          onClose={() => actions.closeDetail()}
        />
      )}
    </div>
  );
}

function DetailBody({
  task,
  projects,
  onClose,
}: {
  task: TaskRecord;
  projects: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [labels, setLabels] = useState(task.labels.join(", "));

  // 远端同步更新时，若输入框未聚焦则跟随刷新
  useEffect(() => {
    if (
      document.activeElement?.tagName !== "INPUT" &&
      document.activeElement?.tagName !== "TEXTAREA"
    ) {
      setTitle(task.title);
      setNotes(task.notes);
      setLabels(task.labels.join(", "));
    }
  }, [task]);

  const patchDebounced = debounce((patch: Parameters<typeof actions.patchTask>[1]) => {
    void actions.patchTask(task.id, patch);
  }, 350);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 md:hidden dark:hover:bg-zinc-800"
        >
          ← 返回
        </button>
        <div className="ml-auto flex items-center gap-2">
          {task.deleted ? (
            <Button
              size="sm"
              onPress={() => void actions.restoreTask(task.id)}
              data-testid="detail-restore"
            >
              从回收站恢复
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => void actions.deleteTask(task.id)}
              data-testid="detail-delete"
              className="text-zinc-400 hover:text-red-500"
            >
              删除
            </Button>
          )}
          <button
            onClick={onClose}
            className="hidden rounded-lg px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-100 md:block dark:hover:bg-zinc-800"
            aria-label="关闭详情"
          >
            ×
          </button>
        </div>
      </div>

      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          patchDebounced({ title: e.target.value });
        }}
        className="text-lg font-semibold"
        data-testid="detail-title"
        aria-label="任务标题"
      />

      <Switch
        isSelected={task.completed}
        onChange={() => void actions.toggleTask(task.id)}
        data-testid="detail-completed"
      >
        已完成
      </Switch>

      <Field label="截止日期">
        <DatePicker
          value={toDateValue(task.due_date)}
          onChange={(v) => void actions.patchTask(task.id, { due_date: fromDateValue(v) })}
          data-testid="detail-due"
          aria-label="截止日期"
        >
          <DatePicker.Trigger data-testid="detail-due-trigger">
            {toDateValue(task.due_date)?.toString() ?? "选择日期"}
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
          <DatePicker.Popover>
            <Calendar />
          </DatePicker.Popover>
        </DatePicker>
        {task.due_date !== null && (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => void actions.patchTask(task.id, { due_date: null })}
            className="text-xs text-zinc-400"
          >
            清除
          </Button>
        )}
      </Field>

      <Field label="优先级">
        <div className="flex gap-1" data-testid="detail-priority">
          {PRIORITIES.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={task.priority === p.value ? "primary" : "ghost"}
              onPress={() => void actions.patchTask(task.id, { priority: p.value })}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="所属项目">
        <Select
          selectedKey={task.project_id || null}
          onSelectionChange={(key) =>
            void actions.patchTask(task.id, { project_id: (key as string) ?? "" })
          }
          data-testid="detail-project"
          aria-label="所属项目"
          fullWidth
        >
          <Select.Trigger>
            <Select.Value />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBoxItem id="">收集箱（无项目）</ListBoxItem>
              {projects.map((p) => (
                <ListBoxItem key={p.id} id={p.id}>
                  {p.name}
                </ListBoxItem>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </Field>

      <Field label="标签（逗号分隔）">
        <Input
          value={labels}
          onChange={(e) => {
            setLabels(e.target.value);
            patchDebounced({
              labels: e.target.value
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
          placeholder="工作, 重要"
          data-testid="detail-labels"
        />
      </Field>

      <Field label="备注">
        <TextArea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            patchDebounced({ notes: e.target.value });
          }}
          rows={6}
          placeholder="补充说明…"
          data-testid="detail-notes"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-zinc-400">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function debounce<F extends (...args: never[]) => void>(fn: F, ms: number): F {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<F>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as F;
}
