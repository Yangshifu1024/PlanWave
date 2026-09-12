import { defineConfig, devices } from "@playwright/test";

// 固定端口约定：API=8787（与 dev/preview 共用，见 src/lib/platform.ts 启发式），
// web=4173。构建不烘焙 VITE_API_BASE——dist 始终是「4173→8787」启发式，
// 这样 E2E、手动 preview、探针用的产物完全一致。
const SERVER_PORT = 8787;
const WEB_PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  // 共享一台内存存储服务器（单账号），测试必须串行
  workers: 1,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `cargo run -p planwave-server`,
      url: `http://127.0.0.1:${SERVER_PORT}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PLANWAVE_LISTEN: `127.0.0.1:${SERVER_PORT}`,
        RUST_LOG: "warn",
      },
    },
    {
      command: `pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
