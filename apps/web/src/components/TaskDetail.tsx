import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  Input,
  ListBox,
  ListBoxItem,
  Select,
  Switch,
  TextArea,
} from "@heroui/react";
import type { RecurrenceFreq, RecurrenceRule, TaskRecord } from "../types";
import { actions, useApp } from "../state/store";
import { fromDateInput, toDateInput } from "../lib/dates";
import { recurrenceLabel } from "../lib/recurrence";
import { AdaptivePane } from "./shell/AdaptivePane";
import { DateField } from "./ui/DateField";
import { NativeSelect } from "./ui/NativeSelect";

export const PRIORITIES: { value: number; label: string }[] = [
  { value: 0, label: "无" },
  { value: 1, label: "低" },
  { value: 2, label: "中" },
  { value: 3, label: "高" },
];

const RECURRENCE_PRESETS: { value: string; label: string }[] = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" },
  { value: "custom", label: "自定义…" },
];

const WEEKDAY_SHORT = ["日", "一", "二", "三", "四", "五", "六"];
const FREQ_OPTIONS: { value: RecurrenceFreq; label: string }[] = [
  { value: "daily", label: "天" },
  { value: "weekly", label: "周" },
  { value: "monthly", label: "月" },
  { value: "yearly", label: "年" },
];

/** 由规则推导选择器档位：interval=1 且周规则未选星期几 → 预设档，否则自定义。 */
function recurrencePreset(r: RecurrenceRule | null): string {
  if (!r) return "none";
  if (r.interval === 1 && !(r.freq === "weekly" && (r.weekdays?.length ?? 0) > 0)) return r.freq;
  return "custom";
}

function applyPreset(r: RecurrenceRule | null, preset: string): RecurrenceRule | null {
  if (preset === "none") return null;
  if (preset === "custom") return r ?? { freq: "daily", interval: 2, weekdays: [] };
  return { freq: preset as RecurrenceFreq, interval: 1, weekdays: [] };
}

interface Draft {
  title: string;
  notes: string;
  labels: string;
  priority: number;
  project_id: string;
  due: string; // yyyy-MM-dd，空串 = 未设置
  recurrence: RecurrenceRule | null;
}

function draftFrom(task: TaskRecord): Draft {
  return {
    title: task.title,
    notes: task.notes,
    labels: task.labels.join(", "),
    priority: task.priority,
    project_id: task.project_id,
    due: toDateInput(task.due_date),
    recurrence: task.recurrence,
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
  if (JSON.stringify(d.recurrence) !== JSON.stringify(task.recurrence)) {
    // null = 清除重复（Set::Clear），对象 = 设置规则
    patch.recurrence = d.recurrence;
  }
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
    <AdaptivePane role="detail" open onClose={() => actions.closeDetail()} testId="task-detail">
      <DetailBody
        key={task.id}
        task={task}
        projects={projects.filter((p) => !p.deleted)}
        onClose={() => actions.closeDetail()}
      />
    </AdaptivePane>
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
  const allTasks = useApp((s) => s.tasks);
  const [subtaskDraft, setSubtaskDraft] = useState("");
  // 子任务（单层）：非删除的、以当前任务为父的任务
  const children = allTasks.filter((c) => c.parent_id === task.id && !c.deleted);
  const doneCount = children.filter((c) => c.completed).length;

  // 远端/同步更新时，若本地没有未保存修改则跟随刷新（正在编辑则不打扰）
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(task));
  }, [task, dirty]);

  const save = async () => {
    if (patch === null) return;
    setDraft((d) => ({ ...d, title: d.title.trim() }));
    await actions.patchTask(task.id, patch);
  };

  const preset = recurrencePreset(draft.recurrence);
  const rule = draft.recurrence;

  const submitSubtask = () => {
    if (!subtaskDraft.trim()) return;
    void actions.addSubtask(task.id, subtaskDraft);
    setSubtaskDraft("");
  };

  return (
    <div className="relative flex h-full flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-sm text-fg-subtle hover:bg-pw-hover md:hidden"
        >
          ← 返回
        </button>
        <div className="ml-auto flex items-center gap-2">
          {task.deleted ? (
            <>
              <Button
                size="sm"
                onPress={() => void actions.restoreTask(task.id)}
                data-testid="detail-restore"
              >
                从回收站恢复
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onPress={() => actions.openPurgeConfirm([task.id])}
                data-testid="detail-purge"
                className="text-fg-subtle hover:text-red-500"
              >
                彻底删除
              </Button>
            </>
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
                onPress={() =>
                  actions.requestConfirm({
                    title: "删除任务",
                    message: `将「${task.title}」移到回收站？可在回收站中恢复。`,
                    confirmLabel: "移到回收站",
                    action: () => actions.deleteTask(task.id),
                  })
                }
                data-testid="detail-delete"
                className="text-fg-subtle hover:text-red-500"
              >
                删除
              </Button>
            </>
          )}
          <button
            onClick={onClose}
            className="hidden rounded-lg px-2 py-1 text-sm text-fg-subtle hover:bg-pw-hover md:block"
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

      {/* 墓碑（回收站中的已删任务）不可再修改完成状态 */}
      {/* 墓碑（回收站中的已删任务）不可再修改完成状态 */}
      <Switch
        isSelected={task.completed}
        isDisabled={task.deleted}
        onChange={() =>
          actions.requestConfirm({
            title: task.completed ? "取消完成" : "完成任务",
            message: `将「${task.title}」标记为${task.completed ? "未完成" : "已完成"}？`,
            confirmLabel: task.completed ? "取消完成" : "完成",
            action: () => actions.toggleTask(task.id),
          })
        }
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
          <DateField
            value={draft.due}
            onChange={(due) => setDraft({ ...draft, due })}
            testId="detail-due"
            ariaLabel="截止日期"
          />
          {draft.due !== "" && (
            <Button
              size="sm"
              variant="ghost"
              onPress={() => setDraft({ ...draft, due: "" })}
              className="shrink-0 text-xs text-fg-subtle"
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

      <Field label="重复">
        <NativeSelect
          value={preset}
          onChange={(value) =>
            setDraft({ ...draft, recurrence: applyPreset(draft.recurrence, value) })
          }
          testId="detail-recurrence"
          ariaLabel="重复规则"
          className="w-full"
        >
          {RECURRENCE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.value === "custom" && rule ? `自定义（${recurrenceLabel(rule)}）` : p.label}
            </option>
          ))}
        </NativeSelect>
        {preset === "custom" && rule && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-pw-surface-2 p-3">
            <span className="text-xs text-fg-subtle">每</span>
            <input
              type="number"
              min={1}
              value={rule.interval}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recurrence: rule && {
                    ...rule,
                    interval: Math.max(1, Number(e.target.value) || 1),
                  },
                })
              }
              data-testid="detail-recurrence-interval"
              aria-label="重复间隔"
              className="w-16 rounded-lg border border-pw-border bg-pw-surface px-2 py-1 text-sm [color-scheme:light] dark:[color-scheme:dark]"
            />
            <select
              value={rule.freq}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  recurrence: { ...rule, freq: e.target.value as RecurrenceFreq },
                })
              }
              aria-label="重复单位"
              className="rounded-lg border border-pw-border bg-pw-surface px-2 py-1 text-sm [color-scheme:light] dark:[color-scheme:dark]"
            >
              {FREQ_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {rule.freq === "weekly" && (
              <span className="flex gap-1">
                {WEEKDAY_SHORT.map((label, idx) => {
                  const active = (rule.weekdays ?? []).includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`size-7 rounded-full text-xs transition ${
                        active
                          ? "bg-blue-500 text-white"
                          : "bg-pw-hover text-fg-muted hover:bg-pw-selected"
                      }`}
                      aria-pressed={active}
                      aria-label={`每周${label}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          recurrence: {
                            ...rule,
                            weekdays: active
                              ? (rule.weekdays ?? []).filter((w) => w !== idx)
                              : [...(rule.weekdays ?? []), idx].sort((a, b) => a - b),
                          },
                        })
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        )}
      </Field>

      <Field label="所属项目">
        <Select
          selectedKey={draft.project_id || null}
          onSelectionChange={(key) => setDraft({ ...draft, project_id: (key as string) ?? "" })}
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

      {!task.deleted && (
        <Field label={`子任务（${doneCount}/${children.length}）`}>
          <ul className="space-y-0.5" data-testid="detail-subtasks">
            {children.map((c) => (
              <li
                key={c.id}
                className="group/sub flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-pw-hover"
              >
                <span onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    isSelected={c.completed}
                    onChange={() =>
                      actions.requestConfirm({
                        title: c.completed ? "取消完成" : "完成子任务",
                        message: `将子任务「${c.title}」标记为${c.completed ? "未完成" : "已完成"}？`,
                        confirmLabel: c.completed ? "取消完成" : "完成",
                        action: () => actions.toggleTask(c.id),
                      })
                    }
                    data-testid={`subtask-check-${c.title}`}
                    aria-label={c.completed ? "标记子任务未完成" : "完成子任务"}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </span>
                <button
                  className={`min-w-0 flex-1 cursor-pointer truncate text-left text-sm ${
                    c.completed ? "text-fg-subtle line-through" : ""
                  }`}
                  onClick={() => actions.selectTask(c.id)}
                  data-testid={`subtask-open-${c.title}`}
                >
                  {c.title}
                </button>
                <Button
                  isIconOnly
                  variant="ghost"
                  onPress={() =>
                    actions.requestConfirm({
                      title: "删除子任务",
                      message: `将子任务「${c.title}」移到回收站？`,
                      confirmLabel: "删除",
                      action: () => actions.deleteTask(c.id),
                    })
                  }
                  aria-label="删除子任务"
                  className="shrink-0 text-fg-subtle opacity-0 transition hover:text-red-500 group-hover/sub:opacity-100 coarse:opacity-100"
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
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitSubtask();
            }}
            className="flex gap-2"
          >
            <Input
              value={subtaskDraft}
              onChange={(e) => setSubtaskDraft(e.target.value)}
              placeholder="添加子任务，回车确认"
              fullWidth
              data-testid="detail-subtask-input"
              aria-label="添加子任务"
            />
          </form>
        </Field>
      )}

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

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-fg-subtle">{label}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
