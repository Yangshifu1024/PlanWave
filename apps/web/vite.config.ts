import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  clearScreen: false,
  build: { target: "es2022" },
  // Tauri 开发时固定端口供 shell 加载
  server: { port: 5173, strictPort: true },
});
