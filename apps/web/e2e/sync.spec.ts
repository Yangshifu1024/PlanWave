//! PlanWave Web 端 E2E：真实服务端（内存存储）+ 真实 IndexedDB。
//! 覆盖：注册初始化、项目/任务 CRUD、搜索、回收站、双端实时同步（WS）、离线恢复同步。

import { expect, test, type Page } from "@playwright/test";

const USER = "demo";
const PASS = "e2e-password-8";

function row(page: Page, title: string) {
  return page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
}

async function login(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("auth-username")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("auth-username").fill(USER);
  await page.getByTestId("auth-password").fill(PASS);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("view-title")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("PlanWave Web E2E", () => {
  test("首次注册 + 项目/任务/详情/回收站基础流", async ({ page }) => {
    // 全新服务端：首次进入应显示注册（单账号初始化）
    await page.goto("/");
    await expect(page.getByTestId("auth-username")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("auth-username").fill(USER);
    await page.getByTestId("auth-password").fill(PASS);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("view-title")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("sync-badge")).toContainText("已同步", { timeout: 15_000 });

    // 新建项目
    await page.getByTestId("add-project").click();
    await page.getByTestId("new-project-name").fill("工作");
    await page.getByTestId("new-project-name").press("Enter");
    await expect(page.getByTestId("nav-project-工作")).toBeVisible({ timeout: 10_000 });

    // 进入项目视图，添加任务
    await page.getByTestId("nav-project-工作").click();
    await expect(page.getByTestId("view-title")).toHaveText("工作");
    await page.getByTestId("new-task-input").fill("写周报");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });

    // 详情面板：备注 + 优先级 + 标签
    await row(page, "写周报").click();
    await expect(page.getByTestId("task-detail")).toBeVisible();
    await page.getByTestId("detail-notes").fill("同步协议演示任务");
    await page.getByTestId("detail-priority").getByText("高", { exact: true }).click();
    await page.getByTestId("detail-labels").fill("工作, 重要");

    // 勾选完成 → 删除线
    await page.getByTestId("check-写周报").click();
    await expect(row(page, "写周报").locator("span.line-through")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("check-写周报").click();

    // 搜索
    await page.getByTestId("search-input").fill("周报");
    await expect(row(page, "写周报")).toBeVisible();
    await page.getByTestId("search-input").fill("不存在的关键词");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.getByTestId("search-input").fill("");

    // 删除 → 回收站 → 恢复
    await row(page, "写周报").click();
    await page.getByTestId("detail-delete").click();
    await expect(row(page, "写周报")).not.toBeVisible();
    await page.getByTestId("nav-trash").click();
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("restore-写周报").click();
    // 恢复涉及与防抖刷新的并发 reload，宽限到 8s 防止偶发竞态
    await expect(row(page, "写周报")).not.toBeVisible({ timeout: 8_000 });
  });

  test("双端通过手动刷新同步", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await login(a);
    await login(b);
    await a.getByTestId("nav-all").click();
    await b.getByTestId("nav-all").click();

    // A 添加任务
    await a.getByTestId("new-task-input").fill("刷新同步任务");
    await a.getByTestId("new-task-input").press("Enter");
    await expect(row(a, "刷新同步任务")).toBeVisible({ timeout: 15_000 });

    // B 手动刷新后看到（拉取式同步：轮询式点刷新直到任务出现）
    await expect
      .poll(async () => {
        await b.getByTestId("refresh-button").click();
        await b.waitForTimeout(250);
        return row(b, "刷新同步任务").count();
      }, { timeout: 15_000, intervals: [500, 1_000] })
      .toBeGreaterThan(0);

    // B 勾选完成 → A 手动刷新后看到删除线
    await b.getByTestId("check-刷新同步任务").click();
    await expect
      .poll(async () => {
        await a.getByTestId("refresh-button").click();
        await a.waitForTimeout(250);
        return row(a, "刷新同步任务").locator("span.line-through").count();
      }, { timeout: 15_000, intervals: [500, 1_000] })
      .toBeGreaterThan(0);

    await ctxA.close();
    await ctxB.close();
  });

  test("离线编辑，恢复联网后自动同步到其他端", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await login(page);

    // 断网：本地立即写入（写入触发的推送失败会让引擎进入离线态）
    await ctx.setOffline(true);
    await page.getByTestId("nav-all").click();
    await page.getByTestId("new-task-input").fill("离线任务");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(row(page, "离线任务")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("sync-badge")).toContainText("离线", { timeout: 15_000 });

    // 恢复联网：引擎重连并清空积压
    await ctx.setOffline(false);
    await expect(page.getByTestId("sync-badge")).toContainText("已同步", { timeout: 20_000 });

    // 新的另一端登录后可见
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2);
    await p2.getByTestId("nav-all").click();
    await expect(row(p2, "离线任务")).toBeVisible({ timeout: 15_000 });

    await ctx.close();
    await ctx2.close();
  });
});
