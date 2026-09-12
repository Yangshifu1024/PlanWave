import { useEffect, useState, type ReactNode } from "react";
import { Button, Input, ListBox, ListBoxItem, Select, Switch, TextArea } from "@heroui/react";
import type { TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { fromDateInput, toDateInput } from "../lib/dates";

const PRIORITIES: { value: number; label: string }[] = [
  { value: 0, label: "无" },
  { value: 1, label: "低" },
  { value: 2, label: "中" },
  { value: 3, label: "高" },
];

interface Draft {
  title: string;
  notes: string;
  labels: string;
  priority: number;
  project_id: string;
  due: string; // yyyy-MM-dd，空串 = 未设置
}

function draftFrom(task: TaskRecord): Draft {
  return {
    title: task.title,
    notes: task.notes,
    labels: task.labels.join(", "),
    priority: task.priority,
    project_id: task.project_id,
    due: toDateInput(task.due_date),
  };
}

/** 与已保存记录逐字段对比，返回需要提交的 patch；无变化返回 null。 */
function diffPatch(task: TaskRecord, d: Draft): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const title = d.title.trim();
  if (title !== task.title) patch.title = title;
  if (d.notes !== task.notes) patch.notes = d.notes;
  const labels = d.labels
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (labels.join(", ") !== task.labels.join(", ")) patch.labels = labels;
  if (d.priority !== task.priority) patch.priority = d.priority;
  if (d.project_id !== task.project_id) patch.project_id = d.project_id;
  const due = fromDateInput(d.due);
  if (due !== task.due_date) patch.due_date = due;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** 右栏任务详情：桌面侧栏、移动端全屏覆盖。字段编辑为草稿，「保存」统一提交。 */
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task));
  const patch = diffPatch(task, draft);
  const dirty = patch !== null;

  // 远端/同步更新时，若本地没有未保存修改则跟随刷新（正在编辑则不打扰）
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(task));
  }, [task, dirty]);

  const save = async () => {
    if (patch === null) return;
    setDraft((d) => ({ ...d, title: d.title.trim() }));
    await actions.patchTask(task.id, patch);
  };

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
            <>
              <Button
                size="sm"
                variant="primary"
                isDisabled={!dirty || !draft.title.trim()}
                onPress={() => void save()}
                data-testid="detail-save"
              >
                保存
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => void actions.deleteTask(task.id)}
                data-testid="detail-delete"
                className="text-zinc-400 hover:text-red-500"
              >
                删除
              </Button>
            </>
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
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        className="text-lg font-semibold"
        fullWidth
        data-testid="detail-title"
        aria-label="任务标题"
      />

      <Switch
        isSelected={task.completed}
        onChange={() => void actions.toggleTask(task.id)}
        data-testid="detail-completed"
      >
        <Switch.Content>
          <span className="text-sm">已完成</span>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>

      <Field label="截止日期">
        <div className="flex w-full items-center gap-2">
          <input
            type="date"
            value={draft.due}
            onChange={(e) => setDraft({ ...draft, due: e.target.value })}
            data-testid="detail-due"
            aria-label="截止日期"
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 [color-scheme:light] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:[color-scheme:dark]"
          />
          {draft.due !== "" && (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setDraft({ ...draft, due: "" })}
              className="shrink-0 text-xs text-zinc-400"
            >
              清除
            </Button>
          )}
        </div>
      </Field>

      <Field label="优先级">
        <div className="flex gap-1" data-testid="detail-priority">
          {PRIORITIES.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={draft.priority === p.value ? "primary" : "ghost"}
              onPress={() => setDraft({ ...draft, priority: p.value })}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </Field>

      <Field label="所属项目">
        <Select
          selectedKey={draft.project_id || null}
          onSelectionChange={(key) =>
            setDraft({ ...draft, project_id: (key as string) ?? "" })
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
          value={draft.labels}
          onChange={(e) => setDraft({ ...draft, labels: e.target.value })}
          placeholder="工作, 重要"
          fullWidth
          data-testid="detail-labels"
        />
      </Field>

      <Field label="备注">
        <TextArea
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          rows={6}
          placeholder="补充说明…"
          fullWidth
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
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
