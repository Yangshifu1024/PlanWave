import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
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
  // Tauri 开发时固定端口供 shell 加载
  server: { port: 5173, strictPort: true },
});
