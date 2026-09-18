//! 自适应壳层模式判定（替代原 useNarrowViewport）。
//!
//! - compact：< 768px —— 底部导航 + 左侧抽屉 + 全屏详情
//! - regular：768–1279px —— 常驻侧栏 + 右侧详情抽屉
//! - wide：≥ 1280px —— 侧栏 + 列表 + 停靠详情三栏
//!
//! jsdom 无 matchMedia 时按 wide 处理（与原 useIsNarrow 的默认一致），
//! 使单测默认走桌面分支。

import { useEffect, useState } from "react";

export type ShellMode = "compact" | "regular" | "wide";

const COMPACT_QUERY = "(max-width: 767px)";
const WIDE_QUERY = "(min-width: 1280px)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function resolve(): ShellMode {
  if (!hasMatchMedia()) return "wide";
  if (window.matchMedia(COMPACT_QUERY).matches) return "compact";
  if (window.matchMedia(WIDE_QUERY).matches) return "wide";
  return "regular";
}

export function useShellMode(): ShellMode {
  const [mode, setMode] = useState<ShellMode>(resolve);
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const compact = window.matchMedia(COMPACT_QUERY);
    const wide = window.matchMedia(WIDE_QUERY);
    const onChange = () => setMode(resolve());
    onChange();
    compact.addEventListener("change", onChange);
    wide.addEventListener("change", onChange);
    return () => {
      compact.removeEventListener("change", onChange);
      wide.removeEventListener("change", onChange);
    };
  }, []);
  return mode;
}

/** 当前是否粗指针（触屏）。jsdom 默认 false。 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    hasMatchMedia() ? window.matchMedia("(pointer: coarse)").matches : false,
  );
  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return coarse;
}
