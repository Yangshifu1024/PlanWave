//! 到期任务本地通知（客户端调度，离线可用）。
//!
//! - Web：Notification API（页面存活期间有效）
//! - Tauri（桌面/移动）：@tauri-apps/plugin-notification 系统通知
//! - 只调度未来 24h 内到期，避免长期定时器堆积；每次数据变更全量重排

import type { TaskRecord } from "../types";
import { isTauri } from "./platform";

const MAX_LEAD_MS = 24 * 3600 * 1000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let permissionGranted = false;

export async function requestReminderPermission(): Promise<void> {
  try {
    if (isTauri) {
      const plugin = await import("@tauri-apps/plugin-notification");
      permissionGranted =
        (await plugin.isPermissionGranted()) ||
        (await plugin.requestPermission()) === "granted";
    } else if (typeof window !== "undefined" && "Notification" in window) {
      permissionGranted =
        Notification.permission === "granted" ||
        (await Notification.requestPermission()) === "granted";
    }
  } catch {
    permissionGranted = false;
  }
}

function fire(title: string, body: string): void {
  if (!permissionGranted) return;
  if (isTauri) {
    void import("@tauri-apps/plugin-notification").then((p) =>
      p.sendNotification({ title, body }),
    );
  } else if (typeof Notification !== "undefined") {
    try {
      new Notification(title, { body });
    } catch {
      /* 通知构造失败（如无 Service Worker 的极端环境）忽略 */
    }
  }
}

/** 全量重排到期提醒（每次本地/远端数据变更后调用）。 */
export function rescheduleReminders(tasks: TaskRecord[]): void {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();

  const now = Date.now();
  for (const task of tasks) {
    if (task.deleted || task.completed || task.due_date === null) continue;
    const delay = task.due_date - now;
    if (delay <= 0 || delay > MAX_LEAD_MS) continue;
    const id = setTimeout(() => {
      timers.delete(task.id);
      fire("PlanWave 任务提醒", task.title);
    }, delay);
    timers.set(task.id, id);
  }
}

/** 仅供测试：当前已调度数量。 */
export function scheduledCount(): number {
  return timers.size;
}
