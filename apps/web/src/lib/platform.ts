//! 平台探测与 API 地址。
//!
//! 客户端（Tauri）与 Web 端共用同一 WASM 数据层；
//! API 地址解析顺序：VITE_API_BASE 显式配置 → 开发/预览端口直连本地服务 → 生产同源 /api 反代。

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (typeof location !== "undefined" && ["5173", "4173"].includes(location.port)
    ? "http://127.0.0.1:8787"
    : `${location.origin}/api`);

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
