//! 视图筛选与排序的纯函数测试。

import { describe, expect, it } from "vitest";
import { countTasks, filterTasks, sortTasks } from "../src/lib/filters";
import type { TaskRecord } from "../src/types";

const DAY = 86_400_000;

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
    ...partial,
  };
}

const now = new Date(2026, 8, 12, 10, 0); // 2026-09-12 10:00

describe("filterTasks", () => {
  it("today 视图：包含今天到期与逾期未完成，排除已完成", () => {
    const tasks = [
      task({ id: "1", title: "今天到期", due_date: now.getTime() - 3600_000 }),
      task({ id: "2", title: "逾期三天", due_date: now.getTime() - 3 * DAY }),
      task({ id: "3", title: "明天", due_date: now.getTime() + DAY }),
      task({ id: "4", title: "已完成但逾期", due_date: now.getTime() - DAY, completed: true }),
      task({ id: "5", title: "无截止" }),
    ];
    const r = filterTasks(tasks, { kind: "smart", smart: "today" }, "", now);
    expect(r.map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("upcoming 视图：未来 7 天内（含今天）未完成", () => {
    const tasks = [
      task({ id: "1", title: "明天", due_date: now.getTime() + DAY }),
      task({ id: "2", title: "第 7 天", due_date: now.getTime() + 7 * DAY }),
      task({ id: "3", title: "第 8 天", due_date: now.getTime() + 8 * DAY }),
      task({ id: "4", title: "昨天", due_date: now.getTime() - DAY }),
    ];
    const r = filterTasks(tasks, { kind: "smart", smart: "upcoming" }, "", now);
    expect(r.map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("project 视图按 project_id 过滤；trash 视图只见墓碑", () => {
    const tasks = [
      task({ id: "1", project_id: "p1" }),
      task({ id: "2", project_id: "p2" }),
      task({ id: "3", project_id: "p1", deleted: true }),
    ];
    expect(filterTasks(tasks, { kind: "project", id: "p1" }, "", now).map((t) => t.id)).toEqual(["1"]);
    expect(filterTasks(tasks, { kind: "smart", smart: "trash" }, "", now).map((t) => t.id)).toEqual(["3"]);
    expect(filterTasks(tasks, { kind: "smart", smart: "all" }, "", now).map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("搜索匹配标题/备注/标签（大小写不敏感）", () => {
    const tasks = [
      task({ id: "1", title: "写周报" }),
      task({ id: "2", notes: "关于 TypeScript 的笔记" }),
      task({ id: "3", labels: ["重要"] }),
      task({ id: "4", title: "无关任务" }),
    ];
    const r = filterTasks(tasks, { kind: "smart", smart: "all" }, "typescript", now);
    expect(r.map((t) => t.id)).toEqual(["2"]);
  });

  it("排序：未完成按截止时间 → 优先级 → 新的在前；已完成垫底", () => {
    const tasks = [
      task({ id: "done", title: "已完成", completed: true }),
      task({ id: "late", title: "高优无截止", priority: 3, sort_order: 1 }),
      task({ id: "due", title: "有截止低优", due_date: now.getTime(), priority: 1, sort_order: 2 }),
    ];
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(["due", "late", "done"]);
  });

  it("countTasks 只统计未完成", () => {
    const tasks = [
      task({ id: "1", title: "a", due_date: now.getTime() }),
      task({ id: "2", title: "b", due_date: now.getTime(), completed: true }),
    ];
    expect(countTasks(tasks, { kind: "smart", smart: "today" }, now)).toBe(1);
  });
});
