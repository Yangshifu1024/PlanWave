//! DayTasksOverlay 测试：任务列表、空态、点条目关闭、添加回调。

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskRecord } from "../src/types";

vi.mock("../src/components/TaskRow", () => ({
  TaskRow: ({ task }: { task: TaskRecord }) => (
    <button data-testid={`row-${task.title}`}>{task.title}</button>
  ),
}));

import { DayTasksOverlay } from "../src/components/DayTasksOverlay";

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

describe("DayTasksOverlay", () => {
  it("列出当天任务", () => {
    render(
      <DayTasksOverlay
        title="9 月 15 日"
        tasks={[task({ id: "1", title: "甲" }), task({ id: "2", title: "乙" })]}
        projects={[]}
        onClose={vi.fn()}
        onAdd={vi.fn()}
      />,
    );
    expect(screen.getByTestId("day-tasks-overlay")).toHaveTextContent("9 月 15 日");
    expect(screen.getByTestId("row-甲")).toBeInTheDocument();
    expect(screen.getByTestId("row-乙")).toBeInTheDocument();
  });

  it("无任务时显示空态", () => {
    render(
      <DayTasksOverlay title="9 月 15 日" tasks={[]} projects={[]} onClose={vi.fn()} onAdd={vi.fn()} />,
    );
    expect(screen.getByText("这天没有任务")).toBeInTheDocument();
  });

  it("点击任务条目关闭浮层", () => {
    const onClose = vi.fn();
    render(
      <DayTasksOverlay
        title="9 月 15 日"
        tasks={[task({ id: "1", title: "甲" })]}
        projects={[]}
        onClose={onClose}
        onAdd={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("row-甲"));
    expect(onClose).toHaveBeenCalled();
  });

  it("点「添加任务到这天」先关浮层再回调", () => {
    const onClose = vi.fn();
    const onAdd = vi.fn();
    render(
      <DayTasksOverlay title="9 月 15 日" tasks={[]} projects={[]} onClose={onClose} onAdd={onAdd} />,
    );
    fireEvent.click(screen.getByTestId("day-add-task"));
    expect(onClose).toHaveBeenCalled();
    expect(onAdd).toHaveBeenCalled();
  });
});
