//! PurgeConfirmDialog 交互测试：级联条数展示、取消与确认。

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "../src/types";

// mock store：状态可变，供各用例设置待确认集合与任务列表
const mockState = {
  purgeConfirm: null as string[] | null,
  tasks: [] as TaskRecord[],
};

vi.mock("../src/state/store", () => ({
  actions: {
    purgeTasks: vi.fn(),
    closePurgeConfirm: vi.fn(),
  },
  useApp: (sel: (s: typeof mockState) => unknown) => sel(mockState),
}));

import { actions } from "../src/state/store";
import { PurgeConfirmDialog } from "../src/components/PurgeConfirmDialog";

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
    deleted: true,
    parent_id,
    recurrence: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.purgeConfirm = null;
  mockState.tasks = [];
});

describe("PurgeConfirmDialog", () => {
  it("purgeConfirm 为空时不渲染", () => {
    render(<PurgeConfirmDialog />);
    expect(screen.queryByTestId("purge-modal")).not.toBeInTheDocument();
  });

  it("展示级联后的总条数与子任务数", () => {
    // 勾选 p1：级联 p1 → c1 → g1，外加已删除的 c2，共 4 条；用户只勾了 1 条
    mockState.purgeConfirm = ["p1"];
    mockState.tasks = [task("p1"), task("c1", "p1"), task("c2", "p1"), task("g1", "c1")];
    render(<PurgeConfirmDialog />);
    const text = screen.getByTestId("purge-modal").textContent ?? "";
    expect(text).toContain("4");
    expect(text).toContain("含 3 个子任务");
    expect(text).toContain("不可恢复");
  });

  it("无级联时不显示子任务提示", () => {
    mockState.purgeConfirm = ["p1"];
    mockState.tasks = [task("p1")];
    render(<PurgeConfirmDialog />);
    const text = screen.getByTestId("purge-modal").textContent ?? "";
    expect(text).not.toContain("子任务");
  });

  it("取消：关闭弹框且不执行删除", () => {
    mockState.purgeConfirm = ["p1"];
    render(<PurgeConfirmDialog />);
    fireEvent.click(screen.getByTestId("purge-cancel"));
    expect(vi.mocked(actions.closePurgeConfirm)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.purgeTasks)).not.toHaveBeenCalled();
  });

  it("确认：以原始勾选集合调用 purgeTasks", () => {
    mockState.purgeConfirm = ["p1", "p2"];
    render(<PurgeConfirmDialog />);
    fireEvent.click(screen.getByTestId("purge-confirm"));
    expect(vi.mocked(actions.purgeTasks)).toHaveBeenCalledWith(["p1", "p2"]);
    expect(vi.mocked(actions.closePurgeConfirm)).not.toHaveBeenCalled();
  });
});
