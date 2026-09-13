//! op 摘要（patch → 中文动作）测试。

import { describe, expect, it } from "vitest";
import { describePatch } from "../src/lib/opSummary";

describe("describePatch", () => {
  it("完成/取消完成", () => {
    expect(describePatch({ type: "task", completed: true })).toBe("完成任务");
    expect(describePatch({ type: "task", completed: false })).toBe("取消完成");
  });

  it("删除/恢复", () => {
    expect(describePatch({ type: "task", deleted: true })).toBe("删除");
    expect(describePatch({ type: "task", deleted: false })).toBe("恢复");
  });

  it("重复规则设置与清除", () => {
    expect(
      describePatch({ type: "task", recurrence: { freq: "daily", interval: 1 } }),
    ).toBe("设置重复");
    expect(describePatch({ type: "task", recurrence: null })).toBe("清除重复");
  });

  it("子任务父级变更", () => {
    expect(describePatch({ type: "task", parent_id: "p1" })).toBe("设为子任务");
    expect(describePatch({ type: "task", parent_id: "" })).toBe("移到顶层");
  });

  it("多字段合并摘要", () => {
    expect(describePatch({ type: "task", title: "x", due_date: 123 })).toBe("改标题、改截止");
  });

  it("项目 patch 与空 patch 兜底", () => {
    expect(describePatch({ type: "project", name: "工作" })).toBe("改名称");
    expect(describePatch({ type: "task" })).toBe("更新");
    expect(describePatch(null)).toBe("更新");
  });
});
