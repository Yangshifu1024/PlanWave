//! 把 op 的字段 patch 翻译成中文动作摘要（同步详情页展示用）。

const TASK_FIELD_LABELS: Record<string, string> = {
  project_id: "移动项目",
  parent_id: "调整父子级",
  title: "改标题",
  notes: "改备注",
  due_date: "改截止",
  priority: "改优先级",
  completed: "勾选状态",
  labels: "改标签",
  sort_order: "调排序",
  deleted: "删除/恢复",
  recurrence: "重复规则",
};

const PROJECT_FIELD_LABELS: Record<string, string> = {
  name: "改名称",
  color: "改颜色",
  sort_order: "调排序",
  deleted: "删除/恢复",
};

/** 生成单条 op 的一句话摘要，如「完成任务」「改标题、改截止」。 */
export function describePatch(patch: Record<string, unknown> | null | undefined): string {
  if (!patch || typeof patch !== "object") return "更新";
  if (patch.type === "task_forget") return "彻底删除";
  const labels = patch.type === "project" ? PROJECT_FIELD_LABELS : TASK_FIELD_LABELS;
  const parts: string[] = [];
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === "completed" && typeof value === "boolean") {
      parts.push(value ? "完成任务" : "取消完成");
      continue;
    }
    if (key === "deleted" && typeof value === "boolean") {
      parts.push(value ? "删除" : "恢复");
      continue;
    }
    if (key === "recurrence") {
      parts.push(value === null ? "清除重复" : "设置重复");
      continue;
    }
    if (key === "parent_id") {
      parts.push(value === null || value === "" ? "移到顶层" : "设为子任务");
      continue;
    }
    parts.push(label);
  }
  return parts.length > 0 ? parts.join("、") : "更新";
}
