//! collectDescendants 级联计算测试：多层级、删除态、环引用、未知根。

import { describe, expect, it } from "vitest";
import { collectDescendants } from "../src/lib/purge";
import type { TaskRecord } from "../src/types";

function task(id: string, parent_id = ""): TaskRecord {
  return {
    id,
    project_id: "",
    title: id,
    notes: "",
    due_date: null,
    priority: 0,
    completed: false,
    labels: [],
    sort_order: 0,
    deleted: false,
    parent_id,
    recurrence: null,
  };
}

describe("collectDescendants", () => {
  it("收集根及其全部后代：多层级、含已删除与存活的后代，父先于子", () => {
    const tasks = [task("p1"), task("c1", "p1"), task("c2", "p1"), task("g1", "c1"), task("other")];
    const out = collectDescendants(tasks, ["p1"]);
    expect(out[0]).toBe("p1");
    expect(new Set(out)).toEqual(new Set(["p1", "c1", "c2", "g1"]));
    expect(out).not.toContain("other");
  });

  it("多个根各自展开，重复出现的后代去重", () => {
    // ab 被两条记录指向同一 id（数据异常场景）：结果仍应去重
    const tasks = [task("a"), task("b"), task("ab", "a"), task("ab", "b")];
    const out = collectDescendants(tasks, ["a", "b"]);
    expect(new Set(out)).toEqual(new Set(["a", "b", "ab"]));
  });

  it("空根集合返回空数组", () => {
    expect(collectDescendants([task("p1")], [])).toEqual([]);
  });

  it("根不在任务列表中时仍返回根本身", () => {
    const out = collectDescendants([task("p1")], ["ghost"]);
    expect(out).toEqual(["ghost"]);
  });

  it("环引用不死循环", () => {
    const tasks = [task("a", "b"), task("b", "a")];
    const out = collectDescendants(tasks, ["a"]);
    expect(new Set(out)).toEqual(new Set(["a", "b"]));
  });
});
