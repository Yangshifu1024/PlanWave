//! Windows 端自绘窗口控制按钮：最小化 / 最大化 / 关闭。
//!
//! Windows 上 Tauri 的 `titleBarStyle: Overlay` 不生效（运行时仅 macOS 实现），
//! 因此 Windows 走 `decorations: false` + 此组件；macOS 的红绿灯由系统绘制。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsApp } from "../lib/platform";

/** Windows 端移除原生装饰边框（含原生标题栏）；只需执行一次。 */
export function initWindowsFrameless(): void {
  if (!isWindowsApp) return;
  void getCurrentWindow()
    .setDecorations(false)
    .catch((e) => console.error("[planwave] setDecorations failed:", e));
}

export function WindowControls() {
  if (!isWindowsApp) return null;
  const win = getCurrentWindow();
  const btn =
    "flex h-9 w-12 items-center justify-center text-zinc-500 transition hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100";
  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 right-0 z-50 flex h-9"
      data-testid="window-controls"
    >
      <button
        className={btn}
        onClick={() => void win.minimize()}
        aria-label="最小化"
        data-testid="win-minimize"
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M1.5 6h9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>
      <button
        className={btn}
        onClick={() => void win.toggleMaximize()}
        aria-label="最大化/还原"
        data-testid="win-maximize"
      >
        <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
          <rect x="1" y="1" width="10" height="10" rx="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
        </svg>
      </button>
      <button
        className={`${btn} hover:bg-red-500 hover:text-white dark:hover:bg-red-500`}
        onClick={() => win.close()}
        aria-label="关闭"
        data-testid="win-close"
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
