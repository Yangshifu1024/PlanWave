//! TaskRow 组件交互测试。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRow } from "../src/components/TaskRow";
import type { TaskRecord } from "../src/types";

vi.mock("../src/state/store", () => ({
  actions: {
    selectTask: vi.fn(),
    toggleTask: vi.fn(),
    deleteTask: vi.fn(),
    restoreTask: vi.fn(),
  },
  useApp: (sel: (s: { selectedTaskId: string | null }) => string | null) =>
    sel({ selectedTaskId: null }),
}));

function task(partial: Partial<TaskRecord>): TaskRecord {
  return {
    id: "t1",
    project_id: "",
    title: "写周报",
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

import { actions } from "../src/state/store";

describe("TaskRow", () => {
  it("渲染标题，勾选框触发 toggleTask", () => {
    const { container } = render(
      <TaskRow task={task({})} showProject={false} projects={[]} />,
    );
    expect(screen.getByText("写周报")).toBeInTheDocument();
    // jsdom 不实现 label 点击转发，直接点底层 input（label 点击路径由 E2E 覆盖）
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(vi.mocked(actions.toggleTask)).toHaveBeenCalledWith("t1");
  });

  it("已完成任务标题带删除线样式", () => {
    render(<TaskRow task={task({ completed: true })} showProject={false} projects={[]} />);
    expect(screen.getByText("写周报")).toHaveClass("line-through");
  });

  it("墓碑行显示恢复按钮并触发 restoreTask", () => {
    render(<TaskRow task={task({ deleted: true })} showProject={false} projects={[]} />);
    fireEvent.click(screen.getByTestId("restore-写周报"));
    expect(vi.mocked(actions.restoreTask)).toHaveBeenCalledWith("t1");
  });

  it("优先级高时显示红色标记", () => {
    const { container } = render(
      <TaskRow task={task({ priority: 3 })} showProject={false} projects={[]} />,
    );
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });
});
