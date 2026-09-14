//! TaskRow 组件交互测试。

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskRow } from "../src/components/TaskRow";
import type { TaskRecord } from "../src/types";

vi.mock("../src/state/store", () => ({
  actions: {
    selectTask: vi.fn(),
    toggleTask: vi.fn(),
    toggleTaskWithUndo: vi.fn(),
    deleteTask: vi.fn(),
    restoreTask: vi.fn(),
    openPurgeConfirm: vi.fn(),
    requestConfirm: vi.fn(),
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
    parent_id: "",
    recurrence: null,
    ...partial,
  };
}

import { actions } from "../src/state/store";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TaskRow", () => {
  it("勾选框即时切换完成状态（带撤销，不再弹确认框）", () => {
    const { container } = render(<TaskRow task={task({})} showProject={false} projects={[]} />);
    expect(screen.getByText("写周报")).toBeInTheDocument();
    // jsdom 不实现 label 点击转发，直接点底层 input（label 点击路径由 E2E 覆盖）
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(vi.mocked(actions.toggleTaskWithUndo)).toHaveBeenCalledWith("t1");
    expect(vi.mocked(actions.requestConfirm)).not.toHaveBeenCalled();
  });

  it("showDivider 时顶层行带内嵌分隔线伪元素类，子任务不显示", () => {
    const { container: withDivider } = render(
      <TaskRow task={task({})} showProject={false} projects={[]} showDivider />,
    );
    expect(withDivider.querySelector('[data-testid="task-row"]')!.className).toContain(
      "before:bg-zinc-200/70",
    );
    const { container: subtask } = render(
      <TaskRow task={task({})} showProject={false} projects={[]} isSubtask />,
    );
    expect(subtask.querySelector('[data-testid="task-row"]')!.className).not.toContain(
      "before:bg-zinc-200/70",
    );
    expect(subtask.querySelector('[data-testid="task-row"]')!.className).toContain("ml-9");
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

  it("墓碑行：完成勾选框被选择框替代，标题带删除线", () => {
    const { container } = render(
      <TaskRow task={task({ deleted: true })} showProject={false} projects={[]} />,
    );
    expect(screen.queryByTestId("check-写周报")).not.toBeInTheDocument();
    expect(screen.getByText("写周报")).toHaveClass("line-through");
    expect(container.querySelector('input[type="checkbox"]')).toBeInTheDocument();
  });

  it("回收站选择框点击触发 onToggleTrashSelect", () => {
    const onToggleTrashSelect = vi.fn();
    const { container } = render(
      <TaskRow
        task={task({ deleted: true })}
        showProject={false}
        projects={[]}
        onToggleTrashSelect={onToggleTrashSelect}
      />,
    );
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(onToggleTrashSelect).toHaveBeenCalledTimes(1);
  });

  it("点击彻底删除按钮触发 openPurgeConfirm", () => {
    render(<TaskRow task={task({ deleted: true })} showProject={false} projects={[]} />);
    fireEvent.click(screen.getByTestId("purge-写周报"));
    expect(vi.mocked(actions.openPurgeConfirm)).toHaveBeenCalledWith(["t1"]);
  });

  it("行内删除按钮触发删除确认", () => {
    render(<TaskRow task={task({})} showProject={false} projects={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "移到回收站" }));
    const request = vi.mocked(actions.requestConfirm).mock.calls[0]![0]!;
    expect(request.title).toBe("删除任务");
    request.action();
    expect(vi.mocked(actions.deleteTask)).toHaveBeenCalledWith("t1");
  });

  it("优先级高时显示红色标记", () => {
    const { container } = render(
      <TaskRow task={task({ priority: 3 })} showProject={false} projects={[]} />,
    );
    expect(container.querySelector(".bg-red-500")).toBeInTheDocument();
  });
});
