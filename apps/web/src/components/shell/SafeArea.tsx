import type { CSSProperties, ReactNode } from "react";

type Edge = "top" | "right" | "bottom" | "left";

const PADDING: Record<Edge, keyof CSSProperties> = {
  top: "paddingTop",
  right: "paddingRight",
  bottom: "paddingBottom",
  left: "paddingLeft",
};

/**
 * 安全区内边距容器：按需把 `--pw-safe-*` 应用为 padding。
 * 永不叠加 `--pw-titlebar`（Titlebar 是它在 AppShell 里的上方兄弟）；
 * BottomNav 挂载时 edges 不含 `"bottom"`（底部安全区由 BottomNav 自己消费一次）。
 */
export function SafeArea({
  children,
  edges = ["top", "right", "bottom", "left"],
  className,
}: {
  children: ReactNode;
  edges?: Edge[];
  className?: string;
}) {
  const style: Record<string, string> = {};
  for (const edge of edges) {
    style[PADDING[edge]] = `var(--pw-safe-${edge})`;
  }
  return (
    <div className={className} style={style as CSSProperties}>
      {children}
    </div>
  );
}
