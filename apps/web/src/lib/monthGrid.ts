//! 月视图纯逻辑：周一起始的固定 6 行月网格、按本地日分桶、未排期筛选。

import type { TaskRecord } from "../types";
import { addDays, startOfDay } from "./dates.js";
import type { ViewKind } from "../state/store.js";
import { filterTasks, sortTasks } from "./filters.js";

/** 单个日期格最多直接渲染的任务条目数，超出进「+N」。 */
export const MONTH_CELL_MAX = 3;

/** 表头星期标签，与周一起始的网格对齐。 */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export interface MonthDay {
  /** 本地当天零点。 */
  date: Date;
  /** yyyy-MM-dd（本地）。 */
  key: string;
  /** 1..31。 */
  day: number;
  /** 是否属于当前月（否则为上下月补位日）。 */
  inMonth: boolean;
  isToday: boolean;
  /** 当天到期且可见的任务（已排序）。 */
  tasks: TaskRecord[];
  /** 超出 `MONTH_CELL_MAX` 的条数。 */
  overflow: number;
}

export interface MonthGrid {
  year: number;
  /** 0-based。 */
  month: number;
  /** 恒为 42 天（6 行 × 7 列）。 */
  days: MonthDay[];
}

/** 本地日期键（yyyy-MM-dd），用作分桶与 testid 后缀。 */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 月份平移：返回目标月 1 日。 */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function monthTitle(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`;
}

/** 网格起始日：包含当月 1 日的那一周的周一。 */
export function monthGridStart(year: number, month: number): Date {
  const first = startOfDay(new Date(year, month, 1));
  const offset = (first.getDay() + 6) % 7; // 0 = 周一
  return addDays(first, -offset);
}

/** 网格顶层任务：顶层，或父缺失/已删的孤儿（与 visibleTree 的「提升」规则一致）。 */
function isGridTopLevel(t: TaskRecord, byId: Map<string, TaskRecord>): boolean {
  if (!t.parent_id) return true;
  const parent = byId.get(t.parent_id);
  return !parent || parent.deleted;
}

/**
 * 构建某月的固定 6 行网格：可见任务按本地 `due_date` 落到对应日；
 * 无截止日的任务不进网格（由「未排期」抽屉承载）。
 */
export function buildMonthGrid(
  tasks: TaskRecord[],
  view: ViewKind,
  year: number,
  month: number,
  opts: { showCompleted?: boolean; now?: Date } = {},
): MonthGrid {
  const { showCompleted = false, now = new Date() } = opts;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visible = filterTasks(tasks, view, "", now).filter(
    (t) => isGridTopLevel(t, byId) && (showCompleted || !t.completed),
  );

  const buckets = new Map<string, TaskRecord[]>();
  for (const t of visible) {
    if (t.due_date === null) continue;
    const key = dayKey(startOfDay(new Date(t.due_date)));
    const list = buckets.get(key) ?? [];
    if (list.length === 0) buckets.set(key, list);
    list.push(t);
  }

  const start = monthGridStart(year, month);
  const todayStart = startOfDay(now).getTime();
  const days: MonthDay[] = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(start, i);
    const key = dayKey(date);
    const dayTasks = sortTasks(buckets.get(key) ?? []);
    days.push({
      date,
      key,
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() === month,
      isToday: date.getTime() === todayStart,
      tasks: dayTasks,
      overflow: Math.max(0, dayTasks.length - MONTH_CELL_MAX),
    });
  }
  return { year, month, days };
}

/** 「未排期」抽屉内容：当前视图下无截止日的顶层未完成任务。 */
export function unscheduledTasks(tasks: TaskRecord[], view: ViewKind, now = new Date()): TaskRecord[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return sortTasks(
    filterTasks(tasks, view, "", now).filter(
      (t) => isGridTopLevel(t, byId) && t.due_date === null && !t.completed,
    ),
  );
}

/** 截止时刻标签：整点 00:00 视为「无时刻」（只靠格子表达日期）。 */
export function dueTimeLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  if (d.getHours() === 0 && d.getMinutes() === 0) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 拖拽改期语义：保留原时刻；原本无日期（从抽屉拖入）→ 目标日 00:00。 */
export function dueForDay(task: TaskRecord, day: Date): number {
  const target = startOfDay(day);
  if (task.due_date === null) return target.getTime();
  const old = new Date(task.due_date);
  target.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
  return target.getTime();
}
