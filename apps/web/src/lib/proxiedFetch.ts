//! 桌面端 HTTP 代理桥：向全局注册 `__PW_FETCH`，同步引擎（WASM）的请求
//! 经此转发到 Tauri 命令，由原生 reqwest 按当前代理档位执行。
//!
//! 注册条件 = Tauri 桌面端；Web/Android 不注册（走原生 fetch，跟随系统）。

import { isDesktopApp } from "./platform";
import { getProxySettings } from "./proxySettings";

interface BridgeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

interface BridgeResponse {
  status: number;
  body: string;
}

/** 在 main.tsx 早期调用：首个请求发出前桥必须就位。 */
export function registerProxiedFetch(): void {
  if (!isDesktopApp) return;
  (window as unknown as Record<string, unknown>).__PW_FETCH = async (init: unknown) => {
    const req = JSON.parse(String(init)) as BridgeRequest;
    const { mode, url } = getProxySettings();
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<BridgeResponse>("http_request", {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      proxy: { mode, url: mode === "custom" ? url : null },
    });
    return JSON.stringify(result);
  };
}
