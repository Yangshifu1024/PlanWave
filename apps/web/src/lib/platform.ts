//! 平台探测与 API 地址。
//!
//! 客户端（Tauri 五端）与 Web 端共用同一 WASM 数据层；API 地址解析顺序：
//! 1. 登录屏用户覆盖（存 localStorage，运行时可改，换服务器免重发版）
//! 2. VITE_API_BASE 构建期配置（随包分发的默认值）
//! 3. 开发/预览端口直连本地服务（仅 web dev/preview）
//! 4. 生产同源 `/api` 反代（web 生产）

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri 桌面端（需要自绘标题栏拖拽区）；移动端有系统 UI，不走这套。 */
export const isDesktopApp =
  isTauri && !/Android|iPhone|iPad/i.test(navigator.userAgent);

/** Tauri Windows 端：无原生标题栏（decorations 关闭），窗口控制按钮由前端自绘。 */
export const isWindowsApp = isDesktopApp && /Windows/i.test(navigator.userAgent);

const API_BASE_KEY = "planwave.api_base";

/** 未做任何覆盖时的默认地址。 */
export const DEFAULT_API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (typeof location !== "undefined" && ["5173", "4173"].includes(location.port)
    ? "http://127.0.0.1:8787"
    : `${location.origin}/api`);

/** 用户覆盖的服务器地址（登录屏可改）。 */
export function getStoredApiBase(): string | null {
  return localStorage.getItem(API_BASE_KEY);
}

/** 当前生效的服务器地址。WASM 客户端构造时读取一次。 */
export function getApiBase(): string {
  return getStoredApiBase() ?? DEFAULT_API_BASE;
}

/**
 * 保存用户输入的服务器地址（去尾部斜杠；空值回退默认地址并清除覆盖）。
 * 返回是否发生变化：变化意味着切换数据空间，调用方必须清空本地缓存与
 * token 后重载页面——WASM 客户端是单例，构造后地址不可更换。
 */
export function applyServerAddress(base: string): boolean {
  const trimmed = base.trim().replace(/\/+$/, "");
  const stored = getStoredApiBase();
  const next = trimmed || null;
  if ((next ?? DEFAULT_API_BASE) === (stored ?? DEFAULT_API_BASE)) return false;
  if (next === null) localStorage.removeItem(API_BASE_KEY);
  else localStorage.setItem(API_BASE_KEY, next);
  return true;
}
