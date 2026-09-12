/** UI 层实体类型（与 Rust sync-core 的记录结构对齐；仅作前端渲染用）。 */

export interface ProjectRecord {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  deleted: boolean;
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
}
