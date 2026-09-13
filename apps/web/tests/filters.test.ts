//! 视图筛选与排序的纯函数测试。

import { describe, expect, it } from "vitest";
import { countTasks, filterTasks, sortTasks, subtaskProgress, visibleTree } from "../src/lib/filters";
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
    parent_id: "",
    recurrence: null,
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

describe("visibleTree（子任务树）", () => {
  const ALL = { kind: "smart", smart: "all" } as const;

  it("子任务缩进挂在父任务下", () => {
    const tasks = [
      task({ id: "p", title: "父" }),
      task({ id: "c1", title: "子1", parent_id: "p" }),
      task({ id: "c2", title: "子2", parent_id: "p" }),
    ];
    const tree = visibleTree(tasks, ALL, "", now);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.task.id).toBe("p");
    expect(tree[0]!.children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("父不在视图时命中的子任务提升为顶层（today 视图）", () => {
    const tasks = [
      task({ id: "p", title: "父：无截止" }),
      task({ id: "c", title: "子：今天到期", parent_id: "p", due_date: now.getTime() }),
    ];
    const tree = visibleTree(tasks, { kind: "smart", smart: "today" }, "", now);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.task.id).toBe("c");
    expect(tree[0]!.children).toHaveLength(0);
  });

  it("搜索命中子任务而父未命中：子任务提升", () => {
    const tasks = [
      task({ id: "p", title: "买菜" }),
      task({ id: "c", title: "买牛奶", parent_id: "p" }),
    ];
    const tree = visibleTree(tasks, ALL, "牛奶", now);
    expect(tree.map((n) => n.task.id)).toEqual(["c"]);
  });

  it("父被删的孤儿子任务按顶层渲染", () => {
    const tasks = [
      task({ id: "p", title: "父（已删）", deleted: true }),
      task({ id: "c", title: "孤儿", parent_id: "p" }),
    ];
    const tree = visibleTree(tasks, ALL, "", now);
    expect(tree.map((n) => n.task.id)).toEqual(["c"]);
    expect(tree[0]!.children).toHaveLength(0);
  });

  it("回收站视图平铺", () => {
    const tasks = [
      task({ id: "p", title: "父", deleted: true }),
      task({ id: "c", title: "子", parent_id: "p", deleted: true }),
    ];
    const tree = visibleTree(tasks, { kind: "smart", smart: "trash" }, "", now);
    expect(tree.map((n) => n.task.id)).toEqual(["p", "c"]);
  });

  it("subtaskProgress 统计非删除子任务", () => {
    const tasks = [
      task({ id: "p", title: "父" }),
      task({ id: "c1", parent_id: "p", completed: true }),
      task({ id: "c2", parent_id: "p" }),
      task({ id: "c3", parent_id: "p", deleted: true }),
    ];
    expect(subtaskProgress(tasks, "p")).toEqual({ done: 1, total: 2 });
  });
});

describe("visibleTree（展开回归）", () => {
  it("父任务在视图内时，不匹配筛选的子任务也挂在父下（展开非空）", () => {
    // 「最近 7 天」视图：父任务周五到期可见，子任务无截止日不匹配筛选
    const friday = now.getTime() + 5 * DAY;
    const tasks = [
      task({ id: "p", title: "父：周五到期", due_date: friday }),
      task({ id: "c1", title: "子1：无截止", parent_id: "p" }),
      task({ id: "c2", title: "子2：无截止", parent_id: "p" }),
    ];
    const tree = visibleTree(tasks, { kind: "smart", smart: "upcoming" }, "", now);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
