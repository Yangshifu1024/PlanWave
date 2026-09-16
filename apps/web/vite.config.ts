import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  // 页面构建版本：与 /about 的服务端版本对比，驱动 Web 端「刷新以更新」提示
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // 拆分第三方库：React 运行时与 UI/工具类 vendor 各自成块（变更频率低，利于缓存），
        // 主包只留应用代码，单块不超过 Vite 默认 500 kB 警告线
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) {
            return "react-vendor";
          }
          return "vendor";
        },
      },
    },
  },
  // Tauri 开发时固定端口供 shell 加载；devUrl 用 localhost。
  // `tauri android dev` 会把 devUrl 的 host 换成局域网 IP 并在启动 BeforeDevCommand 前注入
  // TAURI_DEV_HOST（见 tauri-cli mobile/mod.rs），所以真机调试时必须监听全部网卡，
  // 否则 CLI 会一直等不到 dev server。纯 web 开发（无该变量）仍只绑 localhost。
  server: { port: 5173, strictPort: true, host: process.env.TAURI_DEV_HOST ? true : undefined },
});
