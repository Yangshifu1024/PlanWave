//! 回收站彻底删除的级联计算（纯函数，供 store 与确认弹框共用）。

import type { TaskRecord } from "../types";

/** 收集 rootIds 及其全部后代（沿 parent_id 递归，含已删除与存活的后代）。
 * 返回去重后的 id 列表，父任务先于子任务（BFS）。 */
export function collectDescendants(
  tasks: Pick<TaskRecord, "id" | "parent_id">[],
  rootIds: string[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parent_id) continue;
    const list = childrenOf.get(t.parent_id);
    if (list) {
      list.push(t.id);
    } else {
      childrenOf.set(t.parent_id, [t.id]);
    }
  }
  // 防御环引用：访问过即不再入队
  const seen = new Set<string>();
  const queue = [...rootIds];
  const out: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    const kids = childrenOf.get(id);
    if (kids) queue.push(...kids);
  }
  return out;
}
