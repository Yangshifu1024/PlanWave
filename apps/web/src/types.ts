/** UI 层实体类型（与 Rust sync-core 的记录结构对齐；仅作前端渲染用）。 */

export interface ProjectRecord {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  deleted: boolean;
}

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

/** 重复规则（完成时客户端物化下一次实例；结构须与 Rust RecurrenceRule 一致）。 */
export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** 每 N 天/周/月/年，最小 1。 */
  interval: number;
  /** weekly 专用：每周哪几天（0=周日…6=周六）；空 = 跟随上次到期日的星期。 */
  weekdays?: number[];
}

export interface TaskRecord {
  id: string;
  project_id: string;
  title: string;
  notes: string;
  due_date: number | null;
  /** 0=无 1=低 2=中 3=高 */
  priority: number;
  completed: boolean;
  labels: string[];
  sort_order: number;
  deleted: boolean;
  /** 父任务 id；空串 = 顶层任务。 */
  parent_id: string;
  /** 重复规则；null = 不重复。 */
  recurrence: RecurrenceRule | null;
}

/** 同步详情页的 op 条目（wasm sync_details 返回）。 */
export interface SyncOpInfo {
  op_id: string;
  device_id: string;
  lamport: number;
  entity_id: string;
  client_time_ms: number;
  patch: Record<string, unknown>;
  /** "local"（本地产生）| "remote"（远端应用），仅 recent_ops 有。 */
  dir?: "local" | "remote";
  /** 远端应用时的服务端 seq。 */
  seq?: number;
  /** 日志落库时间（UTC 毫秒），仅 recent_ops 有。 */
  at_ms?: number;
}

export interface SyncDetails {
  meta: {
    device_id: string;
    lamport: number;
    last_pulled_seq: number;
    last_sync_at: number | null;
    last_error: string | null;
    last_pushed: number | null;
    last_pulled: number | null;
  };
  pending: { count: number; ops: SyncOpInfo[] };
  recent_ops: SyncOpInfo[];
}
