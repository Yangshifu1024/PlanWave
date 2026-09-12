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

export function projectNameOf(
  projects: ProjectRecord[],
  id: string,
): string {
  return projects.find((p) => p.id === id)?.name ?? "";
}
