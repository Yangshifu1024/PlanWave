//! QuickAddModal 组件交互测试：标题预填、保存校验、创建参数、关闭放弃、项目默认选中。

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord } from "../src/types";

// mock store：状态可变，供各用例设置当前视图与项目列表
const mockState = {
  projects: [] as ProjectRecord[],
  view: { kind: "smart", smart: "today" } as { kind: string; smart?: string; id?: string },
};

vi.mock("../src/state/store", () => ({
  actions: {
    addTask: vi.fn(),
  },
  useApp: (sel: (s: typeof mockState) => unknown) => sel(mockState),
}));

import { actions } from "../src/state/store";
import { QuickAddModal } from "../src/components/QuickAddModal";

function project(partial: Partial<ProjectRecord>): ProjectRecord {
  return { id: "p1", name: "工作", color: "#000", sort_order: 0, deleted: false, ...partial };
}

function renderModal() {
  const onClose = vi.fn();
  render(<QuickAddModal title="写周报" onClose={onClose} />);
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.projects = [];
  mockState.view = { kind: "smart", smart: "today" };
});

describe("QuickAddModal", () => {
  it("标题预填快速添加输入框的内容", () => {
    renderModal();
    expect(screen.getByTestId("new-task-title")).toHaveValue("写周报");
  });

  it("标题为空时点保存：显示错误、不创建、弹框不关", () => {
    const onClose = renderModal();
    fireEvent.change(screen.getByTestId("new-task-title"), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("new-task-save"));
    expect(screen.getByTestId("new-task-error")).toHaveTextContent("标题不能为空");
    expect(vi.mocked(actions.addTask)).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("修改标题后错误提示消失", () => {
    renderModal();
    fireEvent.change(screen.getByTestId("new-task-title"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("new-task-save"));
    expect(screen.getByTestId("new-task-error")).toBeVisible();
    fireEvent.change(screen.getByTestId("new-task-title"), { target: { value: "新标题" } });
    expect(screen.queryByTestId("new-task-error")).not.toBeInTheDocument();
  });

  it("保存：以表单详情调用 addTask 并关闭弹框（智能视图默认收集箱）", () => {
    const onClose = renderModal();
    fireEvent.click(within(screen.getByTestId("new-task-priority")).getByText("高"));
    fireEvent.change(screen.getByTestId("new-task-due"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByTestId("new-task-labels"), { target: { value: "工作, 重要" } });
    fireEvent.change(screen.getByTestId("new-task-notes"), { target: { value: "同步协议演示" } });
    fireEvent.click(screen.getByTestId("new-task-save"));
    expect(vi.mocked(actions.addTask)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.addTask)).toHaveBeenCalledWith({
      title: "写周报",
      projectId: "",
      priority: 3,
      dueDate: expect.any(Number),
      labels: ["工作", "重要"],
      notes: "同步协议演示",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("项目视图打开时默认选中当前项目并随保存提交", () => {
    mockState.projects = [project({ id: "p1", name: "工作" }), project({ id: "p2", name: "生活" })];
    mockState.view = { kind: "project", id: "p2" };
    renderModal();
    expect(screen.getByTestId("new-task-project")).toHaveTextContent("生活");
    fireEvent.click(screen.getByTestId("new-task-save"));
    expect(vi.mocked(actions.addTask)).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p2" }),
    );
  });

  it("点击关闭：不创建任务，直接回调 onClose", () => {
    const onClose = renderModal();
    fireEvent.click(screen.getByTestId("new-task-close"));
    expect(vi.mocked(actions.addTask)).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
