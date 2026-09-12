//! 日期显示与筛选工具（本地时区）。

import { CalendarDate, parseDate } from "@internationalized/date";

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export type DueLabel = { text: string; tone: "overdue" | "today" | "future" };

/** 截止时间的展示标签：过期红、今天蓝、未来灰。 */
export function dueLabel(ts: number, now = new Date()): DueLabel {
  const due = new Date(ts);
  const todayStart = startOfDay(now).getTime();
  const dueStart = startOfDay(due).getTime();
  const dayDiff = Math.round((dueStart - todayStart) / 86_400_000);

  const time =
    due.getHours() === 0 && due.getMinutes() === 0
      ? ""
      : ` ${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;

  if (dayDiff === 0) return { text: `今天${time}`, tone: "today" };
  if (dayDiff === 1) return { text: `明天${time}`, tone: "future" };
  if (dayDiff === -1) return { text: `昨天${time}`, tone: "overdue" };
  if (dayDiff < 0) return { text: `${-dayDiff} 天前${time}`, tone: "overdue" };
  if (dayDiff < 7) {
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return { text: `${names[due.getDay()]!}${time}`, tone: "future" };
  }
  return {
    text: `${due.getMonth() + 1}月${due.getDate()}日${time}`,
    tone: "future",
  };
}

/** 毫秒时间戳 → React Aria CalendarDate（本地时区的当天）。 */
export function toDateValue(ts: number | null): CalendarDate | null {
  if (ts === null) return null;
  const d = new Date(ts);
  try {
    return parseDate(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    );
  } catch {
    return null;
  }
}

/** CalendarDate → 毫秒时间戳（本地时区当天零点）；null 表示清空。 */
export function fromDateValue(d: CalendarDate | null): number | null {
  if (!d) return null;
  return new Date(d.year, d.month - 1, d.day).getTime();
}
