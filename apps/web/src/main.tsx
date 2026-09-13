import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initWindowsFrameless } from "./components/WindowControls";
import { registerProxiedFetch } from "./lib/proxiedFetch";
import "./styles.css";

// Windows 端去原生标题栏（尽早执行，减少闪烁）；macOS 走 titleBarStyle Overlay，无需处理
initWindowsFrameless();
// 桌面端 HTTP 代理桥（同步引擎经此走带代理的原生请求；须在首个请求前注册）
registerProxiedFetch();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
