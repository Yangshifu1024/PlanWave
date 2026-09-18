import type { ReactNode } from "react";
import { Titlebar } from "./Titlebar";
import { WebUpdateBanner } from "../WebUpdateBanner";

/**
 * 应用外壳：boot / auth / ready 三个阶段共用的根布局（列方向）。
 * Titlebar 与 WebUpdateBanner 在流内位于内容之前，内容区（SafeArea + BottomNav）
 * 由各阶段自行组装。详情覆盖层在 SafeArea 内以 fixed 定位，永不遮住 Titlebar。
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-canvas text-fg">
      <Titlebar />
      <WebUpdateBanner />
      {children}
    </div>
  );
}
