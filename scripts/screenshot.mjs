//! 生成 README 用应用截图：起真实服务端（内存存储）+ vite preview，
//! 注册账号、播种数据后分别在浅色/深色/详情/移动端布局截图。
//! 运行：pnpm --filter @planwave/web exec node ../../scripts/screenshot.mjs

import { createRequire } from "node:module";
import { spawn, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

// 全部基于脚本位置推导绝对路径（脚本可从任意 cwd 运行）
const HERE = new URL(".", import.meta.url);
const ROOT = fileURLToPath(HERE);
const APPS_WEB = fileURLToPath(new URL("../apps/web", HERE));
const OUT = fileURLToPath(new URL("../docs/screenshots", HERE));

// 从 apps/web 的依赖里解析 Playwright（本脚本位于依赖树之外）
const { chromium } = createRequire(new URL("../apps/web/package.json", HERE))(
  "@playwright/test",
);

const SERVER = "http://127.0.0.1:8787";
const WEB = "http://127.0.0.1:4173";
const USER = "demo";
const PASS = "demo-password-8";

async function waitHealth(url, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`等待 ${url} 超时`);
}

async function waitForExit(child) {
  await new Promise((resolve) => child.once("exit", resolve));
}

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  // shell:true 时 child 是外层 shell，需要杀整棵进程树
  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
}

const server = spawn("cargo", ["run", "-p", "planwave-server"], {
  stdio: "ignore",
  env: { ...process.env, PLANWAVE_LISTEN: "127.0.0.1:8787", RUST_LOG: "warn" },
  shell: true,
});
// 构建（API 地址指向本地服务端）后启动静态预览
execSync("pnpm build", {
  cwd: APPS_WEB,
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE: "http://127.0.0.1:8787" },
});
const preview = spawn(
  "pnpm",
  ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { cwd: APPS_WEB, stdio: "ignore", shell: true },
);

try {
  await waitHealth(`${SERVER}/health`, 60_000);
  await waitHealth(WEB, 60_000);
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 })).newPage();

  // 注册进入主界面
  await page.goto(WEB);
  await page.getByTestId("auth-username").fill(USER);
  await page.getByTestId("auth-password").fill(PASS);
  await page.getByTestId("auth-submit").click();
  await page.getByTestId("view-title").waitFor({ timeout: 20_000 });

  // 播种数据
  for (const name of ["工作", "生活", "学习"]) {
    await page.getByTestId("add-project").click();
    await page.getByTestId("new-project-name").fill(name);
    await page.getByTestId("new-project-name").press("Enter");
    await page.waitForTimeout(150);
  }
  await page.getByTestId("nav-all").click();
  const tomorrow = new Date(Date.now() + 86400_000);
  const tasks = [
    ["完成同步协议单元测试", "工作", 3, true],
    ["梳理 oplog 幂等去重逻辑", "工作", 2, false],
    ["准备面试项目讲解大纲", "学习", 3, false],
    ["慢跑 5 公里", "生活", 1, false],
    ["阅读《数据密集型应用》第 5 章", "学习", 2, false],
  ];
  for (const [title, project, priority] of tasks) {
    await page.getByTestId("new-task-input").fill(title);
    await page.getByTestId("new-task-input").press("Enter");
    await page.waitForTimeout(120);
    await page.locator(`[data-task-title="${title}"]`).click();
    await page.getByTestId("detail-priority").getByText(String(["无", "低", "中", "高"][priority]), { exact: true }).click();
    // HeroUI Select 是复合组件：点开弹出层后按角色选选项
    await page.getByTestId("detail-project").click();
    await page.getByRole("option", { name: project }).click();
    await page.getByTestId("task-detail").getByText("×").click();
  }
  // 完成一条
  await page.getByTestId("check-完成同步协议单元测试").click();
  await page.waitForTimeout(600);

  // 1) 主界面（浅色）
  await page.screenshot({ path: `${OUT}/app-light.png` });

  // 2) 详情面板
  await page.locator('[data-task-title="梳理 oplog 幂等去重逻辑"]').click();
  await page.screenshot({ path: `${OUT}/app-detail.png` });
  await page.getByTestId("task-detail").getByText("×").click();

  // 3) 深色模式
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByTestId("theme-toggle").click(); // system → light
  await page.getByTestId("theme-toggle").click(); // light → dark
  await page.screenshot({ path: `${OUT}/app-dark.png` });
  await page.getByTestId("theme-toggle").click(); // dark → system

  // 4) 移动端布局：打开抽屉切到「全部」，收起后截图
  const mobile = await (
    await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: "dark",
    })
  ).newPage();
  await mobile.goto(WEB);
  await mobile.getByTestId("auth-username").fill(USER);
  await mobile.getByTestId("auth-password").fill(PASS);
  await mobile.getByTestId("auth-submit").click();
  await mobile.getByTestId("view-title").waitFor({ timeout: 20_000 });
  await mobile.getByTestId("menu-button").click();
  await mobile.getByTestId("nav-all").click();
  // 等视图真正切换（而非仅点击完成）+ 抽屉收起动画结束
  await mobile.waitForFunction(
    () => document.querySelector('[data-testid="view-title"]')?.textContent === "全部",
    { timeout: 10_000 },
  );
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: `${OUT}/app-mobile.png` });

  await browser.close();
  console.log("screenshots written to docs/screenshots/");
} finally {
  killTree(server);
  killTree(preview);
  await sleep(500);
}
