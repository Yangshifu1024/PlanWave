import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initWindowsFrameless } from "./components/WindowControls";
import "./styles.css";

// Windows 端去原生标题栏（尽早执行，减少闪烁）；macOS 走 titleBarStyle Overlay，无需处理
initWindowsFrameless();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
