//! WASM 单例装载：初始化同步客户端（IndexedDB + HTTP 传输）。
//! JS 侧只保留此薄桥，全部同步语义在 Rust（crates/sync-core + sync-wasm）。

import init from "./pkg/planwave.js";
import { PlanWaveClient } from "./pkg/planwave.js";
import { getApiBase } from "../lib/platform";
import type { ProjectRecord, SyncDetails, TaskRecord } from "../types";

export type { PlanWaveClient };

let instance: PlanWaveClient | null = null;
let initPromise: Promise<PlanWaveClient> | null = null;

/** 已构造的客户端（可能为 null：构造发生在首次登录/注册时）。 */
export function peekClient(): PlanWaveClient | null {
  return instance;
}

/** 获取（并按需初始化）WASM 同步客户端。 */
export async function ensureClient(): Promise<PlanWaveClient> {
  if (instance) return instance;
  if (!initPromise) {
    initPromise = (async () => {
      await init();
      // 地址在构造时确定（登录屏可覆盖）；Rust 侧 new 是 async 关联函数
      // （wasm-bindgen 的 async constructor 已弃用）
      instance = await PlanWaveClient.new(getApiBase());
      return instance;
    })();
  }
  return initPromise;
}

/** 客户端是否有登录态（token 存在即视为已登录，有效性由服务端校验）。 */
export function hasTokens(): boolean {
  return localStorage.getItem("planwave.tokens") !== null;
}

/** WASM 方法返回 JSON 字符串：此包装负责解析并暴露类型化接口。 */
export interface WasmClientApi {
  status(): Promise<{ has_account: boolean }>;
  register(
    username: string,
    password: string,
    deviceId: string,
    deviceName?: string,
  ): Promise<void>;
  login(
    username: string,
    password: string,
    deviceId: string,
    deviceName?: string,
  ): Promise<void>;
  logout(): void;
  setApiBase(base: string): void;
  start(): Promise<void>;
  mutate(entityKind: "task" | "project", entityId: string, patchJson: string): Promise<void>;
  refresh(): Promise<void>;
  listProjects(): Promise<ProjectRecord[]>;
  listTasks(): Promise<TaskRecord[]>;
  syncDetails(limit: number): Promise<SyncDetails>;
  clearLocal(): Promise<void>;
}

/** 把 wasm 原始客户端包装为类型化 API（JSON 字符串 → 对象）。 */
export function wrapClient(raw: PlanWaveClient): WasmClientApi {
  return {
    status: async () => JSON.parse(await raw.status()) as { has_account: boolean },
    register: async (username, password, deviceId, deviceName) => {
      await raw.register(username, password, deviceId, deviceName ?? null);
    },
    login: async (username, password, deviceId, deviceName) => {
      await raw.login(username, password, deviceId, deviceName ?? null);
    },
    logout: () => raw.logout(),
    setApiBase: (base) => raw.set_api_base(base),
    start: () => raw.start(),
    mutate: (entityKind, entityId, patchJson) => raw.mutate(entityKind, entityId, patchJson),
    refresh: () => raw.refresh(),
    listProjects: async () => JSON.parse(await raw.list_projects()) as ProjectRecord[],
    listTasks: async () => JSON.parse(await raw.list_tasks()) as TaskRecord[],
    syncDetails: async (limit) => JSON.parse(await raw.sync_details(limit)) as SyncDetails,
    clearLocal: () => raw.clear_local(),
  };
}

/** 类型化客户端单例。 */
let typed: WasmClientApi | null = null;

export async function ensureTypedClient(): Promise<WasmClientApi> {
  if (!typed) {
    const raw = await ensureClient();
    typed = wrapClient(raw);
    // 调试用：浏览器控制台可通过 __planwave 访问（__planwaveRaw 为原始 wasm 实例）
    (window as unknown as Record<string, unknown>).__planwave = typed;
    (window as unknown as Record<string, unknown>).__planwaveRaw = raw;
  }
  return typed;
}
