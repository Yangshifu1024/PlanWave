import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDesktopApp, isWindowsApp } from "../../lib/platform";

const isMacDesktop = isDesktopApp && /Mac/i.test(navigator.userAgent);

/**
 * 自绘标题栏（唯一拖拽区）：Windows 无边框窗口的控制按钮落在这里，
 * macOS 的 Overlay 红绿灯由系统绘制在其上。Linux / Web 返回 null
 * （`--pw-titlebar: 0`，由平台数据集驱动）。
 *
 * 高度固定为 `--pw-titlebar`，三个面板里原本重复的 36px 占位块由此统一。
 */
export function Titlebar() {
  if (!isWindowsApp && !isMacDesktop) return null;
  return (
    <div
      data-tauri-drag-region
      className="relative z-40 flex h-[var(--pw-titlebar)] shrink-0 items-center bg-canvas pr-[var(--pw-caption-w)] pl-[var(--pw-traffic-pad)]"
    >
      {isWindowsApp && <WindowButtons />}
    </div>
  );
}

function WindowButtons() {
  const win = getCurrentWindow();
  const btn =
    "flex h-full w-12 items-center justify-center text-fg-muted transition hover:bg-pw-hover hover:text-fg";
  return (
    <div className="absolute top-0 right-0 flex h-full" data-testid="window-controls">
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
          <rect
            x="1"
            y="1"
            width="10"
            height="10"
            rx="1.2"
            stroke="currentColor"
            strokeWidth="1.1"
            fill="none"
          />
        </svg>
      </button>
      <button
        className={`${btn} hover:bg-red-500 hover:text-white dark:hover:bg-red-500`}
        onClick={() => win.close()}
        aria-label="关闭"
        data-testid="win-close"
      >
        <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
          <path
            d="M1.5 1.5l9 9M10.5 1.5l-9 9"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
