//! 视口宽度判定（Tailwind md = 768px）。

import { useEffect, useState } from "react";

const WIDE_QUERY = "(min-width: 768px)";

function isWide(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(WIDE_QUERY).matches;
}

/**
 * 当前视口是否为「窄屏」（移动端）。jsdom 无 `matchMedia` 时按宽屏处理，
 * 使单测默认走桌面分支（与真实桌面浏览器一致）。
 */
export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => !isWide());
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(WIDE_QUERY);
    const onChange = () => setNarrow(!mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
