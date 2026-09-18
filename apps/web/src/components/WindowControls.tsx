//! Windows 端自绘窗口控制相关的原生初始化。
//!
//! Windows 上 Tauri 的 `titleBarStyle: Overlay` 不生效（运行时仅 macOS 实现），
//! 因此 Windows 走 `decorations: false` + Titlebar 内自绘按钮（见 shell/Titlebar.tsx）；
//! macOS 的红绿灯由系统绘制。

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsApp } from "../lib/platform";

/** Windows 端移除原生装饰边框（含原生标题栏）；只需执行一次。 */
export function initWindowsFrameless(): void {
  if (!isWindowsApp) return;
  void getCurrentWindow()
    .setDecorations(false)
    .catch((e) => console.error("[planwave] setDecorations failed:", e));
}
