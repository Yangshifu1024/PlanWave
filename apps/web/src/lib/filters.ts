//! 视图筛选与排序（纯函数，便于单测）。

import type { ProjectRecord, TaskRecord } from "../types";
import { addDays, endOfDay, startOfDay } from "./dates.js";
import type { ViewKind } from "../state/store.js";

/** 未完成任务在前：按截止时间（空在后）→ 优先级降序 → sort_order 降序（新的在前）；已完成垫底。 */
export function sortTasks(tasks: TaskRecord[]): TaskRecord[] {
  const active = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);
  const cmp = (a: TaskRecord, b: TaskRecord): number => {
    if (a.due_date !== null && b.due_date !== null && a.due_date !== b.due_date) {
      return a.due_date - b.due_date;
    }
    if (a.due_date === null && b.due_date !== null) return 1;
    if (a.due_date !== null && b.due_date === null) return -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.sort_order - a.sort_order;
  };
  return [...active.sort(cmp), ...done.sort(cmp)];
}

export function filterTasks(
  tasks: TaskRecord[],
  view: ViewKind,
  search: string,
  now = new Date(),
): TaskRecord[] {
  const kw = search.trim().toLowerCase();
  const match = (t: TaskRecord): boolean => {
    if (!kw) return true;
    return (
      t.title.toLowerCase().includes(kw) ||
      t.notes.toLowerCase().includes(kw) ||
      t.labels.some((l) => l.toLowerCase().includes(kw))
    );
  };

  let result: TaskRecord[];
  if (view.kind === "smart" && view.smart === "trash") {
    result = tasks.filter((t) => t.deleted);
  } else if (view.kind === "smart" && view.smart === "all") {
    result = tasks.filter((t) => !t.deleted);
  } else if (view.kind === "smart" && view.smart === "today") {
    const end = endOfDay(now).getTime();
    result = tasks.filter(
      (t) => !t.deleted && !t.completed && t.due_date !== null && t.due_date <= end,
    );
  } else if (view.kind === "smart" && view.smart === "upcoming") {
    const start = startOfDay(now).getTime();
    const end = endOfDay(addDays(now, 7)).getTime();
    result = tasks.filter(
      (t) =>
        !t.deleted && !t.completed && t.due_date !== null && t.due_date >= start && t.due_date <= end,
    );
  } else if (view.kind === "smart") {
    // 兜底（未来新增 smart 类型时不会崩）
    result = tasks.filter((t) => !t.deleted);
  } else {
    result = tasks.filter((t) => !t.deleted && t.project_id === view.id);
  }
  return sortTasks(result.filter(match));
}

export function countTasks(tasks: TaskRecord[], view: ViewKind, now = new Date()): number {
  return filterTasks(tasks, view, "", now).filter((t) => !t.completed).length;
}

/** 任务树节点：父任务 + 归入其下的可见子任务。 */
export interface TaskTree {
  task: TaskRecord;
  children: TaskRecord[];
}

/**
 * 视图可见的任务树（子任务单层嵌套）：
 * - 回收站：平铺（与历史行为一致）；
 * - 父任务在当前视图可见 → 其全部未删除子任务缩进挂在父下（即使子任务自身
 *   不匹配筛选——如「最近 7 天」里无截止日的子任务——否则展开是空的）；
 * - 父任务不在视图（不匹配筛选/搜索）或父已删/缺失 → 命中的子任务提升为顶层行。
 */
export function visibleTree(
  tasks: TaskRecord[],
  view: ViewKind,
  search: string,
  now = new Date(),
): TaskTree[] {
  const flat = filterTasks(tasks, view, search, now);
  if (view.kind === "smart" && view.smart === "trash") {
    return flat.map((task) => ({ task, children: [] }));
  }
  const visible = new Map(flat.map((t) => [t.id, t]));
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const topLevels: TaskRecord[] = [];
  const promoted: TaskRecord[] = [];
  for (const t of flat) {
    if (!t.parent_id) {
      topLevels.push(t);
      continue;
    }
    const parent = byId.get(t.parent_id);
    if (!parent || parent.deleted) {
      // 孤儿子任务（父不存在或已删）：按顶层渲染
      topLevels.push(t);
    } else if (!visible.has(parent.id)) {
      promoted.push(t);
    }
  }
  // 父任务可见 → 全部未删除子任务归入树下，保证展开有内容
  const childrenOf = new Map<string, TaskRecord[]>();
  for (const t of tasks) {
    if (t.deleted || !t.parent_id) continue;
    const parent = byId.get(t.parent_id);
    if (!parent || parent.deleted || !visible.has(parent.id)) continue;
    const list = childrenOf.get(parent.id) ?? [];
    if (list.length === 0) childrenOf.set(parent.id, list);
    list.push(t);
  }
  return sortTasks([...topLevels, ...promoted]).map((task) => ({
    task,
    children: sortTasks(childrenOf.get(task.id) ?? []),
  }));
}

/** 子任务进度（父任务行角标）：全部含已删之外的子任务。 */
export function subtaskProgress(tasks: TaskRecord[], parentId: string): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const t of tasks) {
    if (t.parent_id !== parentId || t.deleted) continue;
    total += 1;
    if (t.completed) done += 1;
  }
  return { done, total };
}

export function projectNameOf(
  projects: ProjectRecord[],
  id: string,
): string {
  return projects.find((p) => p.id === id)?.name ?? "";
}

/** 截止时间分桶（列表页分组用）。 */
export type DueBucket = "overdue" | "today" | "tomorrow" | "thisWeek" | "later" | "none";

/** 分组渲染顺序（空桶不产出）。 */
export const DUE_BUCKET_ORDER: DueBucket[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "later",
  "none",
];

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "逾期",
  today: "今天",
  tomorrow: "明天",
  thisWeek: "7 天内",
  later: "以后",
  none: "无日期",
};

/** 任务落入哪个时间桶：无截止日 → none。按本地时区「日差」计算。 */
export function dueBucket(task: TaskRecord, now = new Date()): DueBucket {
  if (task.due_date === null) return "none";
  const todayStart = startOfDay(now).getTime();
  const dueStart = startOfDay(new Date(task.due_date)).getTime();
  const dayDiff = Math.round((dueStart - todayStart) / 86_400_000);
  if (dayDiff < 0) return "overdue";
  if (dayDiff === 0) return "today";
  if (dayDiff === 1) return "tomorrow";
  if (dayDiff <= 7) return "thisWeek";
  return "later";
}

export interface TaskGroup {
  key: DueBucket;
  label: string;
  nodes: TaskTree[];
}

/**
 * 按截止时间给顶层任务节点分桶：桶内保持入参顺序（调用前已 `sortTasks`），
 * 空桶不产出。父任务入哪个桶，其子任务即跟随（节点是整棵树）。
 */
export function groupByDue(nodes: TaskTree[], now = new Date()): TaskGroup[] {
  const buckets = new Map<DueBucket, TaskTree[]>();
  for (const node of nodes) {
    const key = dueBucket(node.task, now);
    const list = buckets.get(key) ?? [];
    if (list.length === 0) buckets.set(key, list);
    list.push(node);
  }
  return DUE_BUCKET_ORDER.filter((key) => buckets.has(key)).map((key) => ({
    key,
    label: DUE_BUCKET_LABELS[key],
    nodes: buckets.get(key)!,
  }));
}

/** 按顶层节点的完成状态拆分：父完成 → 整棵子树进入 completed。 */
export function splitCompleted(nodes: TaskTree[]): {
  active: TaskTree[];
  completed: TaskTree[];
} {
  const active: TaskTree[] = [];
  const completed: TaskTree[] = [];
  for (const node of nodes) {
    if (node.task.completed) completed.push(node);
    else active.push(node);
  }
  return { active, completed };
}
