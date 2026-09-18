//! 任务条目拖拽（Pointer Events）：位移 > 4px 判定为拖拽，否则松手视为点击。

import {
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { TaskRecord } from "../types";

export const DRAG_START_PX = 4;

export interface TaskChipHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
}

export interface TaskDrag {
  /** 正在拖拽的任务 id；null = 无拖拽。 */
  draggingId: string | null;
  /** 当前悬停的投放目标键（日期的 yyyy-MM-dd，或 "" = 未排期抽屉）；null = 无目标。 */
  overKey: string | null;
  chipProps: (task: TaskRecord) => TaskChipHandlers;
}

export function useTaskDrag(opts: {
  /** 非拖拽的松手 = 点击：打开详情。 */
  onTap: (taskId: string) => void;
  /** 拖拽落点：dropKey 为日期键或 ""（清除日期）。 */
  onDrop: (taskId: string, dropKey: string) => void;
}): TaskDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number; id: string; active: boolean } | null>(null);
  const overKeyRef = useRef<string | null>(null);
  /** 拖拽结束后浏览器仍会补发一次 click，需吞掉以免误开详情。 */
  const suppressClick = useRef(false);

  const reset = () => {
    start.current = null;
    overKeyRef.current = null;
    setDraggingId(null);
    setOverKey(null);
  };

  const chipProps = (task: TaskRecord): TaskChipHandlers => ({
    onPointerDown: (e) => {
      // 拖拽改期仅限鼠标：触屏/触控笔不启动拖拽（点击仍经 onClick 打开详情），
      // 与产品预期「移动端不做拖拽」一致，也避免与滚动争抢手势。
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY, id: task.id, active: false };
      suppressClick.current = false;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件（单测）无真实指针，忽略 */
      }
    },
    onPointerMove: (e) => {
      const st = start.current;
      if (!st) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < DRAG_START_PX) return;
        st.active = true;
        setDraggingId(st.id);
      }
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const zone = el?.closest("[data-drop-key]") as HTMLElement | null;
      const key = zone ? zone.getAttribute("data-drop-key") : null;
      overKeyRef.current = key;
      setOverKey(key);
    },
    onPointerUp: () => {
      const st = start.current;
      const key = overKeyRef.current;
      const active = st?.active ?? false;
      const id = st?.id ?? null;
      reset();
      suppressClick.current = active;
      if (active && id !== null && key !== null) opts.onDrop(id, key);
    },
    onPointerCancel: () => {
      reset();
    },
    onClick: (e) => {
      e.stopPropagation();
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      opts.onTap(task.id);
    },
  });

  return { draggingId, overKey, chipProps };
}
