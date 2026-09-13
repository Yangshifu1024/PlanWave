//! PlanWave Web 端 E2E：真实服务端（内存存储）+ 真实 IndexedDB。
//! 覆盖：注册初始化、项目/任务 CRUD、搜索、回收站、双端实时同步（WS）、离线恢复同步。

import { expect, test, type Page } from "@playwright/test";

const USER = "demo";
const PASS = "e2e-password-8";

function row(page: Page, title: string) {
  return page.locator(`[data-testid="task-row"][data-task-title="${title}"]`);
}

/** 完成任务/删除任务的确认弹框：点确认。 */
async function acceptConfirm(page: Page): Promise<void> {
  await page.getByTestId("confirm-accept").click();
}

/** 等待服务器地址探测通过（凭据输入解锁的前置条件）。 */
async function waitServerChecked(page: Page): Promise<void> {
  await expect(page.getByTestId("server-check")).toContainText("服务器版本", {
    timeout: 15_000,
  });
}

async function login(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("auth-server")).toBeVisible({ timeout: 15_000 });
  await waitServerChecked(page);
  await page.getByTestId("auth-username").fill(USER);
  await page.getByTestId("auth-password").fill(PASS);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("view-title")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("PlanWave Web E2E", () => {
  test("首次注册 + 项目/任务/详情/回收站基础流", async ({ page }) => {
    // 全新服务端：首次进入应显示注册（单账号初始化）
    await page.goto("/");
    await expect(page.getByTestId("auth-server")).toBeVisible({ timeout: 15_000 });
    // 服务器地址运行时可配置（Tauri 端靠它指向自己的实例）；此处保持默认即可
    await waitServerChecked(page);
    await page.getByTestId("auth-username").fill(USER);
    await page.getByTestId("auth-password").fill(PASS);
    await page.getByTestId("auth-submit").click();
    await expect(page.getByTestId("view-title")).toBeVisible({ timeout: 15_000 });
    // 页面与服务器同 tag 构建：不应出现「服务端已更新」刷新横幅
    await expect(page.getByTestId("web-update-banner")).toHaveCount(0);
    await expect(page.getByTestId("sync-badge")).toContainText("已同步", { timeout: 15_000 });

    // 新建项目
    await page.getByTestId("add-project").click();
    await page.getByTestId("new-project-name").fill("工作");
    await page.getByTestId("new-project-name").press("Enter");
    await expect(page.getByTestId("nav-project-工作")).toBeVisible({ timeout: 10_000 });

    // 进入项目视图，添加任务：回车弹出详情表单（先验证空标题校验，再保存创建）
    await page.getByTestId("nav-project-工作").click();
    await expect(page.getByTestId("view-title")).toHaveText("工作");
    await page.getByTestId("new-task-input").fill("写周报");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("new-task-title").fill("");
    await page.getByTestId("new-task-save").click();
    await expect(page.getByTestId("new-task-error")).toBeVisible();
    await page.getByTestId("new-task-title").fill("写周报");
    await page.getByTestId("new-task-save").click();
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });

    // 详情面板（草稿 + 手动保存）：备注 + 优先级 + 标签 + 截止日期
    await row(page, "写周报").click();
    await expect(page.getByTestId("task-detail")).toBeVisible();
    await page.getByTestId("detail-notes").fill("同步协议演示任务");
    await page.getByTestId("detail-priority").getByText("高", { exact: true }).click();
    await page.getByTestId("detail-labels").fill("工作, 重要");
    await page.getByTestId("detail-due").fill("2026-09-20");
    await page.getByTestId("detail-save").click();
    // 保存后同步到列表行：优先级圆点 + 标签
    await expect(row(page, "写周报").locator("span[title='优先级：高']")).toBeVisible({
      timeout: 10_000,
    });
    await expect(row(page, "写周报").getByText("工作", { exact: true })).toBeVisible();

    // 勾选完成（带确认弹框）→ 删除线；再取消完成
    await page.getByTestId("check-写周报").click();
    await acceptConfirm(page);
    await expect(row(page, "写周报").locator("span.line-through")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("check-写周报").click();
    await acceptConfirm(page);

    // 搜索
    await page.getByTestId("search-input").fill("周报");
    await expect(row(page, "写周报")).toBeVisible();
    await page.getByTestId("search-input").fill("不存在的关键词");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.getByTestId("search-input").fill("");

    // 关闭 = 放弃创建：不产生任务
    await page.getByTestId("new-task-input").fill("被放弃的任务");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("new-task-close").click();
    await expect(row(page, "被放弃的任务")).not.toBeVisible();

    // Esc = 放弃创建（与点遮罩同一条关闭路径）：不产生任务
    await page.getByTestId("new-task-input").fill("Esc放弃的任务");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(row(page, "Esc放弃的任务")).not.toBeVisible();

    // 删除 → 回收站 → 恢复
    await row(page, "写周报").click();
    await page.getByTestId("detail-delete").click();
    await acceptConfirm(page);
    await expect(row(page, "写周报")).not.toBeVisible();
    await page.getByTestId("nav-trash").click();
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("restore-写周报").click();
    // 恢复涉及与防抖刷新的并发 reload，宽限到 8s 防止偶发竞态
    await expect(row(page, "写周报")).not.toBeVisible({ timeout: 8_000 });

    // 彻底删除（详情面板入口）：确认后从回收站永久消失
    await page.getByTestId("nav-project-工作").click();
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });
    await row(page, "写周报").click();
    await page.getByTestId("detail-delete").click();
    await acceptConfirm(page);
    await expect(row(page, "写周报")).not.toBeVisible();
    await page.getByTestId("nav-trash").click();
    await expect(row(page, "写周报")).toBeVisible({ timeout: 10_000 });
    await row(page, "写周报").click();
    await page.getByTestId("detail-purge").click();
    await expect(page.getByTestId("purge-modal")).toBeVisible();
    await expect(page.getByTestId("purge-modal")).toContainText("不可恢复");
    await page.getByTestId("purge-confirm").click();
    await expect(row(page, "写周报")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("empty-state")).toBeVisible();

    // 勾选批量删除：再造两个墓碑 → 行首选择框勾选 → 批量彻底删除
    await page.getByTestId("nav-project-工作").click();
    for (const title of ["任务甲", "任务乙"]) {
      await page.getByTestId("new-task-input").fill(title);
      await page.getByTestId("new-task-input").press("Enter");
      await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
      await page.getByTestId("new-task-save").click();
      await expect(row(page, title)).toBeVisible({ timeout: 10_000 });
      await row(page, title).click();
      await page.getByTestId("detail-delete").click();
      await acceptConfirm(page);
      await expect(row(page, title)).not.toBeVisible();
    }
    await page.getByTestId("nav-trash").click();
    await expect(row(page, "任务甲")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("trash-check-任务甲").click();
    await page.getByTestId("trash-check-任务乙").click();
    await expect(page.getByTestId("trash-bulk-bar")).toBeVisible();
    await page.getByTestId("trash-bulk-delete").click();
    await expect(page.getByTestId("purge-modal")).toBeVisible();
    await page.getByTestId("purge-confirm").click();
    await expect(row(page, "任务甲")).not.toBeVisible({ timeout: 10_000 });
    await expect(row(page, "任务乙")).not.toBeVisible();
    await expect(page.getByTestId("empty-state")).toBeVisible();

    // 清空回收站：再造一个墓碑 → 清空按钮 → 全部消失
    await page.getByTestId("nav-project-工作").click();
    await page.getByTestId("new-task-input").fill("任务丙");
    await page.getByTestId("new-task-input").press("Enter");
    await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("new-task-save").click();
    await expect(row(page, "任务丙")).toBeVisible({ timeout: 10_000 });
    await row(page, "任务丙").click();
    await page.getByTestId("detail-delete").click();
    await acceptConfirm(page);
    await expect(row(page, "任务丙")).not.toBeVisible();
    await page.getByTestId("nav-trash").click();
    await expect(row(page, "任务丙")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("trash-clear").click();
    await expect(page.getByTestId("purge-modal")).toBeVisible();
    await page.getByTestId("purge-confirm").click();
    await expect(row(page, "任务丙")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("empty-state")).toBeVisible();
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

    // A 添加任务（回车 → 详情弹框 → 保存）
    await a.getByTestId("new-task-input").fill("刷新同步任务");
    await a.getByTestId("new-task-input").press("Enter");
    await expect(a.getByTestId("new-task-modal")).toBeVisible({ timeout: 15_000 });
    await a.getByTestId("new-task-save").click();
    await expect(row(a, "刷新同步任务")).toBeVisible({ timeout: 15_000 });

    // B 手动刷新后看到（拉取式同步：轮询式点刷新直到任务出现）
    await expect
      .poll(
        async () => {
          await b.getByTestId("refresh-button").click();
          await b.waitForTimeout(250);
          return row(b, "刷新同步任务").count();
        },
        { timeout: 15_000, intervals: [500, 1_000] },
      )
      .toBeGreaterThan(0);

    // B 勾选完成 → A 手动刷新后看到删除线
    await b.getByTestId("check-刷新同步任务").click();
    await b.getByTestId("confirm-accept").click();
    await expect
      .poll(
        async () => {
          await a.getByTestId("refresh-button").click();
          await a.waitForTimeout(250);
          return row(a, "刷新同步任务").locator("span.line-through").count();
        },
        { timeout: 15_000, intervals: [500, 1_000] },
      )
      .toBeGreaterThan(0);

    // A 软删后从回收站彻底删除 → B 手动刷新后永久消失
    await row(a, "刷新同步任务").click();
    await a.getByTestId("detail-delete").click();
    await a.getByTestId("confirm-accept").click();
    await expect(row(a, "刷新同步任务")).not.toBeVisible();
    await a.getByTestId("nav-trash").click();
    await expect(row(a, "刷新同步任务")).toBeVisible({ timeout: 10_000 });
    await a.getByTestId("trash-check-刷新同步任务").click();
    await a.getByTestId("trash-bulk-delete").click();
    await expect(a.getByTestId("purge-modal")).toBeVisible();
    await a.getByTestId("purge-confirm").click();
    await expect(row(a, "刷新同步任务")).not.toBeVisible({ timeout: 10_000 });
    await expect
      .poll(
        async () => {
          await b.getByTestId("refresh-button").click();
          await b.waitForTimeout(250);
          return row(b, "刷新同步任务").count();
        },
        { timeout: 15_000, intervals: [500, 1_000] },
      )
      .toBe(0);

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
    await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("new-task-save").click();
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

  test("项目右键菜单：改色 / 重命名 / 删除（danger 确认）", async ({ page }) => {
    await login(page);

    // 新建专用项目（独立名字避免与其他用例的 testid 冲突）
    await page.getByTestId("add-project").click();
    await page.getByTestId("new-project-name").fill("菜单测试");
    await page.getByTestId("new-project-name").press("Enter");
    await expect(page.getByTestId("nav-project-菜单测试")).toBeVisible({ timeout: 10_000 });

    // ⋯ 按钮唤出菜单（全平台唯一触发入口）
    await page.getByTestId("project-menu-菜单测试").click();
    await expect(page.getByTestId("project-color-gray")).toBeVisible({ timeout: 5_000 });

    // 改色为红：点色板色块，菜单收起，圆点 class 即时变化
    await page.getByTestId("project-color-red").click();
    await expect(page.getByTestId("nav-project-菜单测试").locator("span.rounded-full")).toHaveClass(
      /bg-red-400/,
      { timeout: 10_000 },
    );

    // 重命名：⋯ 按钮开菜单 → 重命名 → 弹窗预填、输入新名、回车提交
    await page.getByTestId("project-menu-菜单测试").click();
    await page.getByRole("menuitem", { name: "重命名" }).click();
    await expect(page.getByTestId("rename-project-dialog")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("rename-project-input")).toHaveValue("菜单测试");
    await page.getByTestId("rename-project-input").fill("菜单改名");
    await page.getByTestId("rename-project-input").press("Enter");
    await expect(page.getByTestId("rename-project-dialog")).toBeHidden({ timeout: 5_000 });
    await expect(page.getByTestId("nav-project-菜单改名")).toBeVisible({ timeout: 10_000 });

    // 删除：菜单红字项 → danger 确认（红色确认按钮）→ 项目消失
    await page.getByTestId("project-menu-菜单改名").click();
    await page.getByRole("menuitem", { name: "删除" }).click();
    await expect(page.getByTestId("confirm-dialog")).toBeVisible({ timeout: 5_000 });
    await acceptConfirm(page);
    await expect(page.getByTestId("nav-project-菜单改名")).toBeHidden({ timeout: 10_000 });
  });
});
