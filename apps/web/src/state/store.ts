//! 全局应用状态（Zustand）：认证阶段、记录缓存、视图状态与所有变更动作。
//!
//! 变更动作全部转调 WASM 同步客户端（本地立即生效 → oplog 队列 → 刷新推送/拉取），
//! store 只负责把本地库的最新状态搬进 React。

import { create } from "zustand";
import type { ProjectRecord, TaskRecord } from "../types";
import { isTauri } from "../lib/platform";
import { ensureTypedClient, hasTokens } from "../wasm/client";
import { requestReminderPermission, rescheduleReminders } from "../lib/reminders";

export type ViewKind =
  | { kind: "smart"; smart: "today" | "upcoming" | "all" | "trash" }
  | { kind: "project"; id: string };

export type Theme = "system" | "light" | "dark";

interface AppState {
  phase: "boot" | "auth" | "ready";
  hasAccount: boolean;
  authError: string | null;
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  view: ViewKind;
  search: string;
  selectedTaskId: string | null;
  syncStatus: "offline" | "syncing" | "online";
  theme: Theme;
  detailOpen: boolean;
  sidebarOpen: boolean;
}

interface AppStore extends AppState {
  setPartial: (p: Partial<AppState>) => void;
}

export const useApp = create<AppStore>()((set) => ({
  phase: "boot",
  hasAccount: false,
  authError: null,
  tasks: [],
  projects: [],
  view: { kind: "smart", smart: "today" },
  search: "",
  selectedTaskId: null,
  syncStatus: "offline",
  theme: "system",
  detailOpen: false,
  sidebarOpen: false,
  setPartial: (p) => set(p),
}));

// ---- 运行时单例（不进入 React 状态） ----
let bootStarted = false;

function deviceDesc(): string {
  const ua = navigator.userAgent;
  if (isTauri) return "PlanWave 客户端";
  if (ua.includes("Android")) return "Android";
  if (/iPhone|iPad/.test(ua)) return "iOS";
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Windows")) return "Windows";
  return "Web";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

export const actions = {
  /** 应用启动（幂等）：初始化 WASM 客户端 → 探测账号 → 已登录则进主界面。 */
  async boot(): Promise<void> {
    if (bootStarted) return;
    bootStarted = true;
    const savedTheme = (localStorage.getItem("planwave.theme") as Theme | null) ?? "system";
    applyTheme(savedTheme);
    useApp.getState().setPartial({ theme: savedTheme });

    const client = await ensureTypedClient();
    // 离线时探测失败不阻塞：有 token 直接进本地优先模式
    let hasAccount = false;
    try {
      hasAccount = (await client.status()).has_account;
    } catch {
      /* 服务端不可达 */
    }
    const signedIn = hasTokens();
    useApp.getState().setPartial({ hasAccount });

    if (signedIn) {
      await actions.enterApp();
    } else {
      useApp.getState().setPartial({ phase: "auth" });
    }
  },

  /** 登录/注册成功后：启动引擎（追平增量）并进入主界面。 */
  async enterApp(): Promise<void> {
    void requestReminderPermission();
    const client = await ensureTypedClient();
    useApp.getState().setPartial({ phase: "ready" });
    console.log("[planwave] enterApp: reload");
    await actions.reload();
    console.log("[planwave] enterApp: engine start");
    try {
      await client.start();
      console.log("[planwave] enterApp: start ok");
      useApp.getState().setPartial({ syncStatus: "online" });
    } catch (e) {
      console.error("[planwave] engine start failed:", String(e).slice(0, 200));
      useApp.getState().setPartial({ syncStatus: "offline" });
    }
    await actions.reload();
    // 前台自动轮询（后台暂停：engine 内部由 JS 定时器驱动）
    startPolling();
  },

  async register(username: string, password: string): Promise<void> {
    const client = await ensureTypedClient();
    try {
      await client.register(username, password, deviceId(), deviceDesc());
      await actions.enterApp();
    } catch (e) {
      useApp.getState().setPartial({ authError: errMsg(e) });
    }
  },

  async login(username: string, password: string): Promise<void> {
    try {
      const client = await ensureTypedClient();
      await client.login(username, password, deviceId(), deviceDesc());
      await actions.enterApp();
    } catch (e) {
      useApp.getState().setPartial({ authError: errMsg(e) });
    }
  },

  async logout(): Promise<void> {
    const client = await ensureTypedClient();
    client.logout();
    useApp.getState().setPartial({ phase: "auth", selectedTaskId: null, detailOpen: false });
  },

  async reload(): Promise<void> {
    // 世代号：并发 reload（如防抖刷新与本地写竞态）时，只有最新发起的一次落 UI，
    // 旧读作废——否则旧数据会覆盖新写，UI 出现「已删除的任务又出现」这类回退。
    const gen = ++reloadGen;
    const client = await ensureTypedClient();
    const [tasks, projects] = await Promise.all([
      client.listTasks(),
      client.listProjects(),
    ]);
    if (gen !== reloadGen) return;
    useApp.getState().setPartial({ tasks, projects });
    rescheduleReminders(tasks);
  },

  setView(view: ViewKind): void {
    useApp.getState().setPartial({ view, search: "", sidebarOpen: false });
  },

  setSearch(search: string): void {
    useApp.getState().setPartial({ search });
  },

  /** 手动刷新：推送本地积压 + 拉取远端增量。 */
  async refresh(): Promise<void> {
    const client = await ensureTypedClient();
    try {
      await client.refresh();
      useApp.getState().setPartial({ syncStatus: "online" });
    } catch {
      useApp.getState().setPartial({ syncStatus: "offline" });
    }
    await actions.reload();
  },

  selectTask(id: string | null): void {
    useApp.getState().setPartial({ selectedTaskId: id, detailOpen: id !== null });
  },

  closeDetail(): void {
    useApp.getState().setPartial({ detailOpen: false });
  },

  toggleSidebar(open?: boolean): void {
    const s = useApp.getState();
    s.setPartial({ sidebarOpen: open ?? !s.sidebarOpen });
  },

  setTheme(theme: Theme): void {
    localStorage.setItem("planwave.theme", theme);
    applyTheme(theme);
    useApp.getState().setPartial({ theme });
  },

  // ---- 领域动作（全部经 WASM 引擎写 oplog） ----

  async addProject(name: string): Promise<void> {
    if (!name.trim()) return;
    const client = await ensureTypedClient();
    await client.mutate(
      "project",
      crypto.randomUUID(),
      JSON.stringify({ name: name.trim(), sort_order: Date.now() }),
    );
    await afterMutate();
  },

  async renameProject(id: string, name: string): Promise<void> {
    const client = await ensureTypedClient();
    await client.mutate("project", id, JSON.stringify({ name }));
    await afterMutate();
  },

  async deleteProject(id: string): Promise<void> {
    const client = await ensureTypedClient();
    await client.mutate("project", id, JSON.stringify({ deleted: true }));
    const s = useApp.getState();
    if (s.view.kind === "project" && s.view.id === id) {
      s.setPartial({ view: { kind: "smart", smart: "today" } });
    }
    await afterMutate();
  },

  async addTask(title: string, projectId?: string): Promise<void> {
    if (!title.trim()) return;
    const s = useApp.getState();
    const project_id = projectId ?? (s.view.kind === "project" ? s.view.id : "");
    const client = await ensureTypedClient();
    await client.mutate(
      "task",
      crypto.randomUUID(),
      JSON.stringify({
        title: title.trim(),
        sort_order: Date.now(),
        ...(project_id ? { project_id } : {}),
      }),
    );
    await afterMutate();
  },

  async toggleTask(id: string): Promise<void> {
    const t = useApp.getState().tasks.find((x) => x.id === id);
    if (!t) return;
    const client = await ensureTypedClient();
    await client.mutate("task", id, JSON.stringify({ completed: !t.completed }));
    await afterMutate();
  },

  async patchTask(id: string, patch: Record<string, unknown>): Promise<void> {
    const client = await ensureTypedClient();
    await client.mutate("task", id, JSON.stringify(patch));
    await afterMutate();
  },

  async deleteTask(id: string): Promise<void> {
    const client = await ensureTypedClient();
    await client.mutate("task", id, JSON.stringify({ deleted: true }));
    const s = useApp.getState();
    if (s.selectedTaskId === id) s.setPartial({ selectedTaskId: null, detailOpen: false });
    await afterMutate();
  },

  async restoreTask(id: string): Promise<void> {
    const client = await ensureTypedClient();
    await client.mutate("task", id, JSON.stringify({ deleted: false }));
    await afterMutate();
  },
};

// ---- 内部工具 ----

/** 本地写后的统一收尾：立即刷新 UI，并安排防抖自动推送（连续编辑合并为一次 push+pull）。 */
async function afterMutate(): Promise<void> {
  scheduleAutoSync();
  await actions.reload();
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
let reloadGen = 0;
function scheduleAutoSync(): void {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null;
    void actions.refresh();
  }, 1_500);
}

function deviceId(): string {
  const existing = localStorage.getItem("planwave.device_id");
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem("planwave.device_id", id);
  return id;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 前台定时轮询（后台标签页暂停）。 */
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void actions.refresh();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void actions.refresh();
  });
  window.addEventListener("online", () => void actions.refresh());
}
