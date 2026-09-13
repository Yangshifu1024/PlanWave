//! 全局应用状态（Zustand）：认证阶段、记录缓存、视图状态与所有变更动作。
//!
//! 变更动作全部转调 WASM 同步客户端（本地立即生效 → oplog 队列 → 刷新推送/拉取），
//! store 只负责把本地库的最新状态搬进 React。

import { create } from "zustand";
import type { ProjectRecord, SyncDetails, TaskRecord } from "../types";
import { isTauri, applyServerAddress, getApiBase } from "../lib/platform";
import { ensureTypedClient, hasTokens, type WasmClientApi } from "../wasm/client";
import { requestReminderPermission, rescheduleReminders } from "../lib/reminders";
import { nextOccurrenceMs } from "../lib/recurrence";
import { collectDescendants } from "../lib/purge";

export type ViewKind =
  | { kind: "smart"; smart: "today" | "upcoming" | "all" | "trash" }
  | { kind: "project"; id: string };

export type Theme = "system" | "light" | "dark";

/** 新建任务输入：缺省字段走创建默认值（sync-core 的 task_defaults）。 */
export interface NewTaskInput {
  title: string;
  /** 不传 = 跟随当前视图（项目视图归项目，其余进收集箱）；空串 = 显式收集箱。 */
  projectId?: string;
  priority?: number;
  /** UTC 毫秒时间戳；不传或 null = 未设置。 */
  dueDate?: number | null;
  notes?: string;
  labels?: string[];
}

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
  /** 刷新进行中（下拉刷新指示器/同步按钮共用）。 */
  refreshing: boolean;
  /** 同步状态详情页开关与数据。 */
  syncSheetOpen: boolean;
  syncDetails: SyncDetails | null;
  theme: Theme;
  detailOpen: boolean;
  sidebarOpen: boolean;
  /** 待确认的彻底删除（回收站）：用户勾选的根任务 id；null = 确认弹框关闭。 */
  purgeConfirm: string[] | null;
  /** 应用更新（桌面/Android）：可用的新版本信息；null = 无。 */
  updateInfo: {
    version: string;
    notes: string;
    url?: string;
    /** Android APK 的 sha256（latest.json 提供，下载后校验）。 */
    sha256?: string;
  } | null;
  /** 更新流程阶段。 */
  updatePhase: "idle" | "checking" | "downloading" | "ready";
  /** 下载进度百分比（仅 downloading 阶段）。 */
  updateProgress: number | null;
  /** 手动检查失败的原因（自动检查静默失败不写此字段）。 */
  updateError: string | null;
  /** 手动检查的反馈文案（如「已是最新版本」）。 */
  updateMessage: string | null;
  /** Web 端：服务器部署版本新于页面构建版本，提示刷新。 */
  webStale: boolean;
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
  refreshing: false,
  syncSheetOpen: false,
  syncDetails: null,
  theme: "system",
  detailOpen: false,
  sidebarOpen: false,
  purgeConfirm: null,
  updateInfo: null,
  updatePhase: "idle",
  updateProgress: null,
  updateError: null,
  updateMessage: null,
  webStale: false,
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

  async register(username: string, password: string, server?: string): Promise<void> {
    await actions.authenticate(username, password, server);
  },

  async login(username: string, password: string, server?: string): Promise<void> {
    await actions.authenticate(username, password, server);
  },

  /**
   * 统一认证入口：以用户输入的服务器地址实测账号状态，动态决定注册还是登录。
   *
   * 首次启动客户端时 boot 阶段的探测可能打在错误的默认地址上（hasAccount 不可信），
   * 所以提交时必须重新探测：服务端已有账号 → login；没有 → register。
   * 注册撞上「账号已存在」（多端竞态）时自动回退登录再试一次。
   */
  async authenticate(username: string, password: string, server?: string): Promise<void> {
    const baseChanged = server !== undefined && applyServerAddress(server);
    const client = await ensureTypedClient();
    if (baseChanged) {
      // 地址变化 = 换数据空间：清空旧 token 与本地库，并把 WASM 单例的
      // 传输地址热切换到新值（否则 status() 仍打在构造时的旧地址上）
      localStorage.removeItem("planwave.tokens");
      await client.clearLocal();
      client.setApiBase(getApiBase());
      useApp.getState().setPartial({ hasAccount: false });
    }

    let hasAccount: boolean | null = null;
    try {
      hasAccount = (await client.status()).has_account;
    } catch {
      useApp.getState().setPartial({
        authError: "无法连接服务器，请检查服务器地址与网络后重试",
        hasAccount: false,
      });
      return;
    }
    useApp.getState().setPartial({ hasAccount });

    try {
      if (hasAccount) {
        await client.login(username, password, deviceId(), deviceDesc());
      } else {
        await client.register(username, password, deviceId(), deviceDesc());
      }
      await actions.enterApp();
    } catch (e) {
      // 新服务器注册失败（账号实际已存在的竞态）：回退登录再试一次
      if (!hasAccount) {
        try {
          await client.login(username, password, deviceId(), deviceDesc());
          await actions.enterApp();
          return;
        } catch {
          /* 两次都失败，展示原始错误 */
        }
      }
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
    const [tasks, projects] = await Promise.all([client.listTasks(), client.listProjects()]);
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
    useApp.getState().setPartial({ refreshing: true, syncStatus: "syncing" });
    try {
      await client.refresh();
      useApp.getState().setPartial({ syncStatus: "online" });
    } catch {
      useApp.getState().setPartial({ syncStatus: "offline" });
    } finally {
      useApp.getState().setPartial({ refreshing: false });
    }
    await actions.reload();
  },

  // ---- 同步状态详情页 ----

  async openSyncSheet(): Promise<void> {
    useApp.getState().setPartial({ syncSheetOpen: true });
    await actions.loadSyncDetails();
  },

  closeSyncSheet(): void {
    useApp.getState().setPartial({ syncSheetOpen: false });
  },

  async loadSyncDetails(): Promise<void> {
    const client = await ensureTypedClient();
    try {
      const details = await client.syncDetails(50);
      useApp.getState().setPartial({ syncDetails: details });
    } catch {
      /* 引擎不可用时保持旧数据 */
    }
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

  /** 新建任务（不存在即创建，upsert 语义）；未提供的字段由 sync-core 落创建默认值。 */
  async addTask(input: NewTaskInput): Promise<void> {
    const title = input.title.trim();
    if (!title) return;
    const s = useApp.getState();
    const project_id = input.projectId ?? (s.view.kind === "project" ? s.view.id : "");
    const { priority = 0, notes = "", labels = [], dueDate = null } = input;
    const client = await ensureTypedClient();
    await client.mutate(
      "task",
      crypto.randomUUID(),
      JSON.stringify({
        title,
        sort_order: Date.now(),
        ...(project_id ? { project_id } : {}),
        ...(priority ? { priority } : {}),
        ...(notes ? { notes } : {}),
        ...(labels.length ? { labels } : {}),
        ...(dueDate !== null ? { due_date: dueDate } : {}),
      }),
    );
    await afterMutate();
  },

  async toggleTask(id: string): Promise<void> {
    const t = useApp.getState().tasks.find((x) => x.id === id);
    if (!t) return;
    const client = await ensureTypedClient();
    const completing = !t.completed;
    await client.mutate("task", id, JSON.stringify({ completed: !t.completed }));
    // 完成带重复规则的任务：物化下一次到期的新实例（取消完成不物化）
    if (completing && t.recurrence) {
      await materializeNextOccurrence(client, t);
    }
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

  /** 回收站：请求彻底删除（打开确认弹框）。ids 为用户勾选的根，级联在执行时展开。 */
  openPurgeConfirm(ids: string[]): void {
    if (ids.length === 0) return;
    useApp.getState().setPartial({ purgeConfirm: ids });
  },

  closePurgeConfirm(): void {
    useApp.getState().setPartial({ purgeConfirm: null });
  },

  /** 彻底删除（forget op）：级联展开整棵后代树（含存活子任务）后逐实体清除，
   *  记录将从本机、服务器与所有端永久移除。仅用于回收站。 */
  async purgeTasks(ids: string[]): Promise<void> {
    const s = useApp.getState();
    // 防御：只对仍是墓碑的根做级联展开（勾选集可能在确认前因恢复而过期）
    const roots = ids.filter((id) => s.tasks.some((t) => t.id === id && t.deleted));
    if (roots.length === 0) {
      s.setPartial({ purgeConfirm: null });
      return;
    }
    const all = collectDescendants(s.tasks, roots);
    const client = await ensureTypedClient();
    for (const id of all) {
      await client.forget("task", id);
    }
    const latest = useApp.getState();
    if (latest.selectedTaskId && all.includes(latest.selectedTaskId)) {
      latest.setPartial({ selectedTaskId: null, detailOpen: false });
    }
    latest.setPartial({ purgeConfirm: null });
    await afterMutate();
  },

  /** 添加子任务：子任务 = 带 parent_id 的普通任务，项目归属继承父任务。 */
  async addSubtask(parentId: string, title: string): Promise<void> {
    const parent = useApp.getState().tasks.find((x) => x.id === parentId);
    if (!parent || !title.trim()) return;
    const client = await ensureTypedClient();
    await client.mutate(
      "task",
      crypto.randomUUID(),
      JSON.stringify({
        title: title.trim(),
        sort_order: Date.now(),
        parent_id: parentId,
        ...(parent.project_id ? { project_id: parent.project_id } : {}),
      }),
    );
    await afterMutate();
  },
};

// ---- 内部工具 ----

/**
 * 物化重复任务的下一次实例：克隆本体字段（标题/备注/标签/优先级/项目/
 * 重复规则），到期 = nextOccurrence(规则, max(到期日, 现在))；
 * 未完成的子任务一并克隆。当前任务保留为已完成。
 */
async function materializeNextOccurrence(client: WasmClientApi, t: TaskRecord): Promise<void> {
  const rule = t.recurrence;
  if (!rule) return;
  const now = Date.now();
  const nextDue = nextOccurrenceMs(rule, t.due_date ?? now, now);
  const newId = crypto.randomUUID();
  await client.mutate(
    "task",
    newId,
    JSON.stringify({
      title: t.title,
      notes: t.notes,
      labels: t.labels,
      priority: t.priority,
      sort_order: now,
      due_date: nextDue,
      recurrence: rule,
      ...(t.project_id ? { project_id: t.project_id } : {}),
    }),
  );
  const children = useApp
    .getState()
    .tasks.filter((c) => c.parent_id === t.id && !c.deleted && !c.completed);
  for (const c of children) {
    await client.mutate(
      "task",
      crypto.randomUUID(),
      JSON.stringify({
        title: c.title,
        notes: c.notes,
        labels: c.labels,
        priority: c.priority,
        sort_order: c.sort_order,
        parent_id: newId,
        ...(c.project_id ? { project_id: c.project_id } : {}),
        ...(c.due_date !== null ? { due_date: c.due_date } : {}),
      }),
    );
  }
}

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
