//! 移动端下拉刷新手势（touch 事件，桌面端无 touch 输入不受影响）。
//!
//! 实现要点：
//! - 必须用原生 `addEventListener(..., { passive: false })` 才能对 touchmove
//!   preventDefault（React 合成 touch 事件是 passive 的）；
//! - 仅在容器 scrollTop<=0 且下拉时接管手势并阻止原生滚动，
//!   其余方向/场景完全放行给原生滚动；
//! - 阻尼位移（0.4 倍）+ 阈值（64px）判定触发，刷新期间指示器持续显示；
//! - 用**回调 ref** 挂监听：列表体是条件挂载的（月视图切换会卸载/重挂），
//!   一次性 `useEffect` 会在「启动即月视图」时漏挂，之后切回列表也补不上。

import { useCallback, useRef, useState } from "react";

export type PullPhase = "idle" | "pulling" | "ready" | "refreshing";

const THRESHOLD = 64;
const MAX_PULL = 120;
const DAMPING = 0.4;

export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const elRef = useRef<HTMLUListElement | null>(null);
  const [pullPx, setPullPx] = useState(0);
  const [phase, setPhase] = useState<PullPhase>("idle");
  // 手势状态放 ref：touchmove 高频触发，避免闭包读到旧 state
  const gesture = useRef({ startY: 0, active: false, pulling: false, phase: "idle" as PullPhase });
  // onRefresh 每次渲染都是新函数：放进 ref，让下面的事件回调保持稳定
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const onTouchStart = useCallback((e: TouchEvent) => {
    const el = elRef.current;
    if (!el || el.scrollTop > 0) return;
    const y = e.touches[0]?.clientY;
    if (y === undefined) return;
    gesture.current.startY = y;
    gesture.current.active = true;
    gesture.current.pulling = false;
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    const el = elRef.current;
    const g = gesture.current;
    if (!el || !g.active || g.phase === "refreshing") return;
    const delta = (e.touches[0]?.clientY ?? 0) - g.startY;
    // 只接管「顶部下拉」：其余情况（上滑、已滚离顶部）全部交还原生滚动
    if (delta <= 0 || el.scrollTop > 0) {
      if (g.pulling) {
        g.pulling = false;
        g.phase = "idle";
        setPhase("idle");
        setPullPx(0);
      }
      return;
    }
    e.preventDefault();
    g.pulling = true;
    const damped = Math.min(MAX_PULL, delta * DAMPING);
    const next: PullPhase = damped >= THRESHOLD ? "ready" : "pulling";
    g.phase = next;
    setPhase(next);
    setPullPx(damped);
  }, []);

  const onTouchEnd = useCallback(() => {
    const g = gesture.current;
    g.active = false;
    if (!g.pulling) return;
    g.pulling = false;
    if (g.phase === "ready") {
      g.phase = "refreshing";
      setPhase("refreshing");
      setPullPx(THRESHOLD / 2);
      void Promise.resolve(onRefreshRef.current()).finally(() => {
        g.phase = "idle";
        setPhase("idle");
        setPullPx(0);
      });
    } else {
      g.phase = "idle";
      setPhase("idle");
      setPullPx(0);
    }
  }, []);

  const ref = useCallback(
    (el: HTMLUListElement | null) => {
      const prev = elRef.current;
      if (prev === el) return;
      if (prev) {
        prev.removeEventListener("touchstart", onTouchStart);
        prev.removeEventListener("touchmove", onTouchMove);
        prev.removeEventListener("touchend", onTouchEnd);
        prev.removeEventListener("touchcancel", onTouchEnd);
      }
      elRef.current = el;
      if (el) {
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        el.addEventListener("touchcancel", onTouchEnd, { passive: true });
      }
    },
    [onTouchStart, onTouchMove, onTouchEnd],
  );

  return { ref, pullPx, phase, threshold: THRESHOLD };
}
