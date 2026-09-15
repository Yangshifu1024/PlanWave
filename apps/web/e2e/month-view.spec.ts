//! PlanWave 月视图 E2E：切换呈现、点格新建（日期预填）、格内勾选、鼠标拖拽改期。
//! 与 sync.spec.ts 共用一台内存存储服务器与单账号，串行执行；每条用例自建自己的任务。

import { expect, test, type Page } from "@playwright/test";

const USER = "demo";
const PASS = "e2e-password-8";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** 本地日期键（与 monthGrid.dayKey 一致）。 */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 等待服务器地址探测通过（凭据输入解锁的前置条件）。 */
async function waitServerChecked(page: Page): Promise<void> {
  await expect(page.getByTestId("server-check")).toContainText("服务器版本", { timeout: 15_000 });
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

/** 进入「全部」的月视图。 */
async function openMonthView(page: Page): Promise<void> {
  await login(page);
  await page.getByTestId("nav-all").click();
  await expect(page.getByTestId("view-title")).toHaveText("全部");
  await page.getByTestId("view-mode-month").click();
  await expect(page.getByTestId("month-view")).toBeVisible();
  await expect(page.getByTestId("task-list")).toHaveCount(0);
}

/** 点今天格子的日期数字区域新建一个当天任务。 */
async function createTaskToday(page: Page, title: string): Promise<void> {
  const today = new Date();
  const cell = page.getByTestId(`month-day-${dayKey(today)}`);
  await cell.getByText(String(today.getDate()), { exact: true }).click();
  await expect(page.getByTestId("new-task-modal")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("new-task-due")).toHaveValue(dayKey(today));
  await page.getByTestId("new-task-title").fill(title);
  await page.getByTestId("new-task-save").click();
  await expect(page.getByTestId(`month-chip-${title}`)).toBeVisible({ timeout: 10_000 });
}

test.describe.serial("PlanWave 月视图 E2E", () => {
  test("切换月视图 + 点格新建预填日期", async ({ page }) => {
    await openMonthView(page);
    await createTaskToday(page, "月视图点格新建");
  });

  test("格内勾选完成（默认隐藏已完成，条目从网格消失）", async ({ page }) => {
    await openMonthView(page);
    await createTaskToday(page, "月视图勾选任务");
    await page.getByTestId("month-check-月视图勾选任务").click();
    await expect(page.getByTestId("month-chip-月视图勾选任务")).toHaveCount(0, { timeout: 10_000 });
  });

  test("鼠标拖拽任务改期到明天", async ({ page }) => {
    await openMonthView(page);
    await createTaskToday(page, "月视图拖拽任务");

    const todayKey = dayKey(new Date());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dayKey(tomorrow);

    const chip = page.getByTestId("month-chip-月视图拖拽任务");
    const from = await chip.boundingBox();
    const to = await page.getByTestId(`month-day-${tomorrowKey}`).boundingBox();
    if (!from || !to) throw new Error("缺少拖拽坐标");

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2 + 24, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(
      page.getByTestId(`month-day-${tomorrowKey}`).getByTestId("month-chip-月视图拖拽任务"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByTestId(`month-day-${todayKey}`).getByTestId("month-chip-月视图拖拽任务"),
    ).toHaveCount(0);
  });
});
