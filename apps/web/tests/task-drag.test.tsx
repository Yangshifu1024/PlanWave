//! useTaskDrag：仅鼠标可拖拽改期，触屏/触控笔不启动拖拽（点击不受影响）。

import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAG_START_PX, useTaskDrag } from "../src/lib/useTaskDrag";
import type { TaskRecord } from "../src/types";

function task(): TaskRecord {
  return {
    id: "t1",
    project_id: "",
    title: "拖拽任务",
    notes: "",
    due_date: null,
    priority: 0,
    completed: false,
    labels: [],
    sort_order: 0,
    deleted: false,
    parent_id: "",
    recurrence: null,
  };
}

function pointerEvent(partial: Record<string, unknown>): ReactPointerEvent<HTMLElement> {
  return {
    pointerType: "mouse",
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    currentTarget: { setPointerCapture: () => {} },
    ...partial,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

const originalElementFromPoint = document.elementFromPoint;

beforeEach(() => {
  // jsdom 未实现 elementFromPoint，拖拽命中检测由测试注入
  document.elementFromPoint = (() => null) as typeof document.elementFromPoint;
});

afterEach(() => {
  document.elementFromPoint = originalElementFromPoint;
});

describe("useTaskDrag", () => {
  it("触屏（pointerType=touch）不启动拖拽，也不触发 onDrop", () => {
    const onTap = vi.fn();
    const onDrop = vi.fn();
    const { result } = renderHook(() => useTaskDrag({ onTap, onDrop }));
    const handlers = result.current.chipProps(task());

    act(() => {
      handlers.onPointerDown(pointerEvent({ pointerType: "touch" }));
      handlers.onPointerMove(pointerEvent({ pointerType: "touch", clientX: 100, clientY: 100 }));
      handlers.onPointerUp(pointerEvent({ pointerType: "touch" }));
    });

    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.draggingId).toBeNull();
  });

  it("鼠标拖拽越过阈值并落在投放区时触发 onDrop", () => {
    const zone = document.createElement("div");
    zone.dataset.dropKey = "2026-09-16";
    document.elementFromPoint = (() => zone) as typeof document.elementFromPoint;

    const onTap = vi.fn();
    const onDrop = vi.fn();
    const { result } = renderHook(() => useTaskDrag({ onTap, onDrop }));
    const handlers = result.current.chipProps(task());

    act(() => {
      handlers.onPointerDown(pointerEvent({}));
      handlers.onPointerMove(
        pointerEvent({ clientX: DRAG_START_PX + 10, clientY: DRAG_START_PX + 10 }),
      );
      handlers.onPointerUp(pointerEvent({}));
    });

    expect(onDrop).toHaveBeenCalledWith("t1", "2026-09-16");
  });
});
