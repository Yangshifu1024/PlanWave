//! 月视图纯逻辑测试：周一起始网格、本地日分桶、溢出计数、未排期筛选、拖拽改期语义。

import { describe, expect, it } from "vitest";
import {
  MONTH_CELL_MAX,
  addMonths,
  buildMonthGrid,
  dayKey,
  dueForDay,
  dueTimeLabel,
  monthTitle,
  unscheduledTasks,
} from "../src/lib/monthGrid";
import type { TaskRecord } from "../src/types";

function task(partial: Partial<TaskRecord> & { id: string }): TaskRecord {
  return {
    project_id: "",
    title: "",
    notes: "",
    due_date: null,
    priority: 0,
    completed: false,
    labels: [],
    sort_order: 0,
    deleted: false,
    parent_id: "",
    recurrence: null,
    ...partial,
  };
}

// 2026-09-15 是周二；因此 9 月 1 日也是周二，周一起始的网格从 8 月 31 日（周一）开始
const now = new Date(2026, 8, 15, 10, 0);
const ALL = { kind: "smart", smart: "all" } as const;

describe("buildMonthGrid 网格结构", () => {
  it("周一起始、固定 42 天，首尾跨月补位", () => {
    const grid = buildMonthGrid([], ALL, 2026, 8, { now });
    expect(grid.days).toHaveLength(42);
    expect(grid.days[0]!.key).toBe("2026-08-31");
    expect(grid.days[6]!.key).toBe("2026-09-06");
    expect(grid.days[41]!.key).toBe("2026-10-11");
    expect(grid.days[0]!.inMonth).toBe(false);
    expect(grid.days[1]!.inMonth).toBe(true); // 2026-09-01
  });

  it("闰年 2 月与年末跨年", () => {
    const leap = buildMonthGrid([], ALL, 2028, 1, { now });
    expect(leap.days.some((d) => d.key === "2028-02-29" && d.inMonth)).toBe(true);
    const dec = buildMonthGrid([], ALL, 2026, 11, { now });
    expect(dec.days.filter((d) => d.inMonth)).toHaveLength(31);
  });

  it("标记今天", () => {
    const grid = buildMonthGrid([], ALL, 2026, 8, { now });
    const todays = grid.days.filter((d) => d.isToday);
    expect(todays.map((d) => d.key)).toEqual(["2026-09-15"]);
  });
});

describe("buildMonthGrid 分桶", () => {
  it("按本地日归入格子，晚 23:00 的截止不被挪到次日", () => {
    const tasks = [
      task({ id: "1", title: "早", due_date: new Date(2026, 8, 15, 3, 0).getTime() }),
      task({ id: "2", title: "晚", due_date: new Date(2026, 8, 15, 23, 0).getTime() }),
    ];
    const grid = buildMonthGrid(tasks, ALL, 2026, 8, { now });
    const day = grid.days.find((d) => d.key === "2026-09-15")!;
    expect(day.tasks.map((t) => t.id).sort()).toEqual(["1", "2"]);
  });

  it("无截止日的任务不进网格", () => {
    const grid = buildMonthGrid([task({ id: "x", title: "无日期" })], ALL, 2026, 8, { now });
    expect(grid.days.every((d) => d.tasks.length === 0)).toBe(true);
  });

  it("只显示顶层任务；父已删的孤儿子任务提升入格", () => {
    const tasks = [
      task({ id: "p", title: "父", due_date: new Date(2026, 8, 15).getTime() }),
      task({ id: "c", title: "子", parent_id: "p", due_date: new Date(2026, 8, 15).getTime() }),
      task({ id: "op", title: "孤儿", parent_id: "gone", due_date: new Date(2026, 8, 15).getTime() }),
    ];
    const day = buildMonthGrid(tasks, ALL, 2026, 8, { now }).days.find(
      (d) => d.key === "2026-09-15",
    )!;
    expect(day.tasks.map((t) => t.id).sort()).toEqual(["op", "p"]);
  });

  it("已完成任务默认不显示，开关打开后显示", () => {
    const tasks = [task({ id: "d", completed: true, due_date: new Date(2026, 8, 15).getTime() })];
    const key = "2026-09-15";
    expect(
      buildMonthGrid(tasks, ALL, 2026, 8, { now }).days.find((d) => d.key === key)!.tasks,
    ).toHaveLength(0);
    expect(
      buildMonthGrid(tasks, ALL, 2026, 8, { now, showCompleted: true }).days.find(
        (d) => d.key === key,
      )!.tasks,
    ).toHaveLength(1);
  });

  it("溢出计数：超过 3 条记录 +N", () => {
    const tasks = [0, 1, 2, 3].map((i) =>
      task({ id: String(i), due_date: new Date(2026, 8, 15).getTime() }),
    );
    const day = buildMonthGrid(tasks, ALL, 2026, 8, { now }).days.find(
      (d) => d.key === "2026-09-15",
    )!;
    expect(day.tasks).toHaveLength(4);
    expect(day.overflow).toBe(4 - MONTH_CELL_MAX);
  });

  it("项目视图只收录该项目任务", () => {
    const tasks = [
      task({ id: "a", project_id: "p1", due_date: new Date(2026, 8, 15).getTime() }),
      task({ id: "b", project_id: "p2", due_date: new Date(2026, 8, 15).getTime() }),
    ];
    const day = buildMonthGrid(tasks, { kind: "project", id: "p1" }, 2026, 8, { now }).days.find(
      (d) => d.key === "2026-09-15",
    )!;
    expect(day.tasks.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("unscheduledTasks", () => {
  it("只取无截止日的顶层未完成任务，按视图隔离", () => {
    const tasks = [
      task({ id: "1", title: "无日期", project_id: "p1" }),
      task({ id: "2", title: "有日期", project_id: "p1", due_date: now.getTime() }),
      task({ id: "3", title: "已完成", project_id: "p1", completed: true }),
      task({ id: "4", title: "子任务", project_id: "p1", parent_id: "1" }),
      task({ id: "5", title: "别的项目", project_id: "p2" }),
      task({ id: "6", title: "已删", project_id: "p1", deleted: true }),
    ];
    expect(unscheduledTasks(tasks, { kind: "project", id: "p1" }, now).map((t) => t.id)).toEqual([
      "1",
    ]);
    expect(unscheduledTasks(tasks, ALL, now).map((t) => t.id).sort()).toEqual(["1", "5"]);
  });
});

describe("辅助函数", () => {
  it("monthTitle / addMonths / dayKey", () => {
    expect(monthTitle(2026, 8)).toBe("2026 年 9 月");
    const shifted = addMonths(new Date(2026, 11, 31), 1);
    expect(shifted.getFullYear()).toBe(2027);
    expect(shifted.getMonth()).toBe(0);
    expect(dayKey(new Date(2026, 8, 5))).toBe("2026-09-05");
  });

  it("dueTimeLabel 整点视为无时刻", () => {
    expect(dueTimeLabel(new Date(2026, 8, 15, 0, 0).getTime())).toBeNull();
    expect(dueTimeLabel(new Date(2026, 8, 15, 9, 5).getTime())).toBe("09:05");
    expect(dueTimeLabel(null)).toBeNull();
  });

  it("dueForDay 保留原时刻；无日期落到目标日零点", () => {
    const withTime = task({ id: "1", due_date: new Date(2026, 8, 1, 14, 30).getTime() });
    const moved = new Date(dueForDay(withTime, new Date(2026, 9, 3)));
    expect([moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()]).toEqual([
      9, 3, 14, 30,
    ]);
    const noDate = task({ id: "2" });
    const placed = new Date(dueForDay(noDate, new Date(2026, 9, 3)));
    expect([placed.getMonth(), placed.getDate(), placed.getHours()]).toEqual([9, 3, 0]);
  });
});
