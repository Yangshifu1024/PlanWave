//! MonthView 渲染测试：网格结构、今天高亮、点格新建、溢出浮层、未排期抽屉。

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectRecord, TaskRecord } from "../src/types";

const mocks = vi.hoisted(() => ({
  actions: {
    selectTask: vi.fn(),
    rescheduleTaskWithUndo: vi.fn(),
    patchTask: vi.fn(),
    toggleTaskWithUndo: vi.fn(),
    toggleUnscheduled: vi.fn(),
    setViewMode: vi.fn(),
  },
  state: {
    tasks: [] as TaskRecord[],
    projects: [] as ProjectRecord[],
    view: { kind: "smart", smart: "all" } as
      | { kind: "smart"; smart: string }
      | { kind: "project"; id: string },
    unscheduledOpen: true,
  },
}));

const mockActions = mocks.actions;
const mockState = mocks.state;

vi.mock("../src/state/store", () => {
  const useApp = (sel: (s: typeof mocks.state) => unknown) => sel(mocks.state);
  (useApp as unknown as { getState: () => typeof mocks.state }).getState = () => mocks.state;
  return { actions: mocks.actions, useApp };
});

vi.mock("../src/components/TaskRow", () => ({
  PRIORITY_STYLE: {
    3: { dot: "bg-red-500", label: "高" },
    2: { dot: "bg-orange-400", label: "中" },
    1: { dot: "bg-yellow-400", label: "低" },
  },
  REPEAT_ICON: <span data-testid="repeat-icon" />,
  TaskRow: () => null,
}));

vi.mock("../src/components/QuickAddModal", () => ({
  QuickAddModal: ({ dueDate }: { dueDate?: number | null }) => (
    <div data-testid="quick-add-modal" data-due={String(dueDate ?? "")} />
  ),
}));

vi.mock("../src/components/DayTasksOverlay", () => ({
  DayTasksOverlay: ({ title }: { title: string }) => (
    <div data-testid="day-tasks-overlay">{title}</div>
  ),
}));

import { MonthView } from "../src/components/MonthView";

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

const TODAY = "2026-09-15";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 15, 10, 0));
  mockState.tasks = [];
  mockState.projects = [];
  mockState.view = { kind: "smart", smart: "all" };
  mockState.unscheduledOpen = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MonthView 网格", () => {
  it("固定渲染 42 个日期格并高亮今天", () => {
    render(<MonthView />);
    expect(screen.getAllByTestId(/^month-day-/)).toHaveLength(42);
    const today = screen.getByTestId(`month-day-${TODAY}`);
    const num = within(today).getByText("15");
    expect(num.className).toContain("bg-blue-500");
  });

  it("渲染当天任务条目与项目色点", () => {
    mockState.projects = [{ id: "p1", name: "工作", color: "red", sort_order: 0, deleted: false }];
    mockState.tasks = [
      task({ id: "1", title: "A", project_id: "p1", due_date: new Date(2026, 8, 15, 9, 0).getTime() }),
      task({ id: "2", title: "B", due_date: new Date(2026, 8, 15, 9, 0).getTime() }),
    ];
    render(<MonthView />);
    expect(screen.getByTestId("month-chip-A")).toBeInTheDocument();
    expect(screen.getByTestId("month-chip-B")).toBeInTheDocument();
  });

  it("点击任务条目打开详情而非新建", () => {
    mockState.tasks = [task({ id: "1", title: "A", due_date: new Date(2026, 8, 15).getTime() })];
    render(<MonthView />);
    fireEvent.click(screen.getByTestId("month-chip-A"));
    expect(mockActions.selectTask).toHaveBeenCalledWith("1");
    expect(screen.queryByTestId("quick-add-modal")).not.toBeInTheDocument();
  });

  it("格内勾选完成调用 toggleTaskWithUndo 而非打开详情", () => {
    mockState.tasks = [task({ id: "1", title: "A", due_date: new Date(2026, 8, 15).getTime() })];
    render(<MonthView />);
    fireEvent.click(screen.getByTestId("month-check-A"));
    expect(mockActions.toggleTaskWithUndo).toHaveBeenCalledWith("1");
    expect(mockActions.selectTask).not.toHaveBeenCalled();
  });
});

describe("MonthView 交互", () => {
  it("点击空白格新建并预填该日期", () => {
    render(<MonthView />);
    fireEvent.click(screen.getByTestId("month-day-2026-09-16"));
    const modal = screen.getByTestId("quick-add-modal");
    expect(modal).toHaveAttribute("data-due", String(new Date(2026, 8, 16).getTime()));
  });

  it("超过 3 条显示 +N，点击打开当天浮层", () => {
    mockState.tasks = [0, 1, 2, 3].map((i) =>
      task({ id: String(i), title: `T${i}`, due_date: new Date(2026, 8, 15).getTime() }),
    );
    render(<MonthView />);
    expect(screen.getByTestId("month-chip-T0")).toBeInTheDocument();
    expect(screen.queryByTestId("month-chip-T3")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`month-more-${TODAY}`));
    expect(screen.getByTestId("day-tasks-overlay")).toBeInTheDocument();
  });

  it("月份导航切到上个月", () => {
    render(<MonthView />);
    expect(screen.getByTestId("month-title")).toHaveTextContent("2026 年 9 月");
    fireEvent.click(screen.getByTestId("month-prev"));
    expect(screen.getByTestId("month-title")).toHaveTextContent("2026 年 8 月");
    fireEvent.click(screen.getByTestId("month-today"));
    expect(screen.getByTestId("month-title")).toHaveTextContent("2026 年 9 月");
  });

  it("未排期抽屉列出无日期任务并支持折叠", () => {
    mockState.tasks = [task({ id: "1", title: "无日期" })];
    render(<MonthView />);
    expect(screen.getByTestId("unscheduled-chip-无日期")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unscheduled-toggle"));
    expect(mockActions.toggleUnscheduled).toHaveBeenCalled();
  });
});
