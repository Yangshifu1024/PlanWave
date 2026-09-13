-- 子任务与重复任务字段（v0.2.0）
-- parent_id：父任务 id，'' = 顶层任务（子任务 = 带 parent_id 的普通任务，单层）
-- recurrence：重复规则 JSON，NULL = 不重复（结构见 sync-core 的 RecurrenceRule）

ALTER TABLE tasks
    ADD COLUMN parent_id CHAR(36) NOT NULL DEFAULT '' AFTER project_id,
    ADD COLUMN recurrence JSON NULL AFTER labels;
