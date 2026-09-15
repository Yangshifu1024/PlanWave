//! TaskList 列表渲染测试：时间分组、已完成折叠分区、搜索平铺、回收站平铺。

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord, TaskRecord } from "../src/types";

const DAY = 86_400_000;

const mockState = {
  tasks: [] as TaskRecord[],
  projects: [] as ProjectRecord[],
  view: { kind: "smart", smart: "all" } as
    | { kind: "smart"; smart: string }
    | { kind: "project"; id: string },
  viewMode: "list" as "list" | "month",
  search: "",
  syncStatus: "online" as const,
};

vi.mock("../src/state/store", () => {
  const useApp = (sel: (s: typeof mockState) => unknown) => sel(mockState);
  (useApp as unknown as { getState: () => typeof mockState }).getState = () => mockState;
  return {
    actions: {
      refresh: vi.fn(),
      toggleSidebar: vi.fn(),
      setSearch: vi.fn(),
      setViewMode: vi.fn(),
      openSyncSheet: vi.fn(),
      openPurgeConfirm: vi.fn(),
      selectTask: vi.fn(),
      toggleTaskWithUndo: vi.fn(),
    },
    useApp,
  };
});

vi.mock("../src/components/MonthView", () => ({ MonthView: () => <div data-testid="month-view" /> }));

vi.mock("../src/lib/usePullToRefresh", () => ({
  usePullToRefresh: () => ({ ref: () => {}, pullPx: 0, phase: "idle" }),
}));

vi.mock("../src/components/SyncStatusSheet", () => ({ SyncStatusSheet: () => null }));

vi.mock("../src/components/TaskRow", () => ({
  TaskRow: ({ task }: { task: TaskRecord }) => (
    <div data-testid="task-row" data-task-title={task.title}>
      {task.title}
    </div>
  ),
}));

import { TaskList } from "../src/components/TaskList";

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

const now = Date.now();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockState.tasks = [];
  mockState.projects = [];
  mockState.view = { kind: "smart", smart: "all" };
  mockState.viewMode = "list";
  mockState.search = "";
});

describe("TaskList 分组", () => {
  it("按截止时间渲染分组标题与数量，空桶不渲染", () => {
    mockState.tasks = [
      task({ id: "1", title: "逾期", due_date: now - DAY }),
      task({ id: "2", title: "今天", due_date: now }),
      task({ id: "3", title: "无日期" }),
    ];
    render(<TaskList />);
    expect(screen.getByTestId("group-overdue")).toHaveTextContent("逾期");
    expect(screen.getByTestId("group-today")).toHaveTextContent("今天");
    expect(screen.getByTestId("group-none")).toHaveTextContent("无日期");
    expect(screen.queryByTestId("group-tomorrow")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("task-row")).toHaveLength(3);
  });

  it("today 视图只渲染逾期/今天两个分组", () => {
    mockState.view = { kind: "smart", smart: "today" };
    mockState.tasks = [
      task({ id: "1", title: "逾期", due_date: now - DAY }),
      task({ id: "2", title: "今天", due_date: now }),
      task({ id: "3", title: "以后", due_date: now + 30 * DAY }),
    ];
    render(<TaskList />);
    expect(screen.getByTestId("group-overdue")).toBeInTheDocument();
    expect(screen.getByTestId("group-today")).toBeInTheDocument();
    expect(screen.queryByTestId("group-later")).not.toBeInTheDocument();
  });
});

describe("TaskList 已完成分区", () => {
  it("默认折叠：已完成任务不渲染，点击后展开", () => {
    mockState.tasks = [
      task({ id: "1", title: "进行中" }),
      task({ id: "2", title: "已完成任务", completed: true }),
    ];
    render(<TaskList />);
    expect(screen.getByTestId("completed-toggle")).toHaveTextContent("已完成 1");
    expect(screen.queryByText("已完成任务")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("completed-toggle"));
    expect(screen.getByText("已完成任务")).toBeInTheDocument();
  });

  it("展开偏好写入 localStorage", () => {
    mockState.tasks = [task({ id: "2", title: "已完成任务", completed: true })];
    render(<TaskList />);
    fireEvent.click(screen.getByTestId("completed-toggle"));
    expect(localStorage.getItem("planwave.ui.showCompleted")).toBe("true");
  });
});

describe("TaskList 平铺分支", () => {
  it("搜索时平铺（无分组、无已完成分区），包含已完成结果", () => {
    mockState.search = "周报";
    mockState.tasks = [
      task({ id: "1", title: "写周报" }),
      task({ id: "2", title: "周报归档", completed: true }),
    ];
    render(<TaskList />);
    expect(screen.queryByTestId("completed-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-none")).not.toBeInTheDocument();
    expect(screen.getByText("写周报")).toBeInTheDocument();
    expect(screen.getByText("周报归档")).toBeInTheDocument();
  });

  it("回收站平铺：不分组、无已完成分区", () => {
    mockState.view = { kind: "smart", smart: "trash" };
    mockState.tasks = [task({ id: "1", title: "墓碑", deleted: true })];
    render(<TaskList />);
    expect(screen.queryByTestId("group-none")).not.toBeInTheDocument();
    expect(screen.queryByTestId("completed-toggle")).not.toBeInTheDocument();
    expect(screen.getByText("墓碑")).toBeInTheDocument();
  });
});

describe("TaskList 空态", () => {
  it("空列表渲染空态", () => {
    render(<TaskList />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
  });
});

describe("TaskList 月视图切换", () => {
  it("「全部」与项目视图显示切换器", () => {
    render(<TaskList />);
    expect(screen.getByTestId("view-mode-toggle")).toBeInTheDocument();
  });

  it("今天视图不显示切换器", () => {
    mockState.view = { kind: "smart", smart: "today" };
    render(<TaskList />);
    expect(screen.queryByTestId("view-mode-toggle")).not.toBeInTheDocument();
  });

  it("viewMode=month 时渲染月视图而非列表体", () => {
    mockState.viewMode = "month";
    render(<TaskList />);
    expect(screen.getByTestId("month-view")).toBeInTheDocument();
    expect(screen.queryByTestId("task-list")).not.toBeInTheDocument();
  });

  it("今天视图即便偏好为月也强制列表", () => {
    mockState.view = { kind: "smart", smart: "today" };
    mockState.viewMode = "month";
    render(<TaskList />);
    expect(screen.queryByTestId("month-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-list")).toBeInTheDocument();
  });
});
