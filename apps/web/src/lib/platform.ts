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

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri 桌面端（需要自绘标题栏拖拽区）；移动端有系统 UI，不走这套。 */
export const isDesktopApp = isTauri && !/Android|iPhone|iPad/i.test(navigator.userAgent);

/** Tauri Windows 端：无原生标题栏（decorations 关闭），窗口控制按钮由前端自绘。 */
export const isWindowsApp = isDesktopApp && /Windows/i.test(navigator.userAgent);

const API_BASE_KEY = "planwave.api_base";

/** 地址归一化：去首尾空白与尾部斜杠。 */
export function normalizeApiBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

/** 未做任何覆盖时的默认地址。 */
export const DEFAULT_API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (typeof location !== "undefined" && ["5173", "4173"].includes(location.port)
    ? "http://127.0.0.1:8787"
    : `${location.origin}/api`);

/**
 * 把平台事实写到 `<html>` 数据集上，供纯 CSS 自适应（chrome / 安全区）消费：
 * - `data-os`：windows / macos / linux / android / ios / web
 * - `data-chrome`：windows（无边框 + 自绘按钮）/ macos（Overlay 红绿灯）/ linux（原生装饰，无 Web 标题栏）/ none
 * - `data-insets`：native（Android 已在 MainActivity 原生补过内边距，Web 侧不得再补）/ css
 *
 * chrome 由 **OS** 决定，而非 isDesktopApp——Linux 的 Overlay 不生效，保留原生标题栏。
 */
export function applyPlatformAttrs(): void {
  const el = document.documentElement;
  const ua = navigator.userAgent;
  const android = isTauri && /Android/i.test(ua);
  const ios = isTauri && /iPhone|iPad/i.test(ua);

  if (isWindowsApp) {
    el.dataset.os = "windows";
    el.dataset.chrome = "windows";
  } else if (isDesktopApp && /Mac/i.test(ua)) {
    el.dataset.os = "macos";
    el.dataset.chrome = "macos";
  } else if (isDesktopApp) {
    el.dataset.os = "linux";
    el.dataset.chrome = "linux";
  } else {
    el.dataset.os = android ? "android" : ios ? "ios" : "web";
    el.dataset.chrome = "none";
  }
  el.dataset.insets = android ? "native" : "css";
}

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
 * token，并通过客户端的 `setApiBase` 热切换地址（WASM 客户端是单例，
 * 构造后默认地址不可更换，热切换是唯一入口）。
 */
export function applyServerAddress(base: string): boolean {
  const next = normalizeApiBase(base) || null;
  const stored = getStoredApiBase();
  if ((next ?? DEFAULT_API_BASE) === (stored ?? DEFAULT_API_BASE)) return false;
  if (next === null) localStorage.removeItem(API_BASE_KEY);
  else localStorage.setItem(API_BASE_KEY, next);
  return true;
}
