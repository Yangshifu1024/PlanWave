//! 字段级合并语义：把 patch 应用到实体记录。
//!
//! 规则（必须保持 deterministic，与存储端 SQL/JS 实现一致）：
//! - patch 中缺席的字段不动；`Set::Clear` 清空；`Set::Value` 覆盖；
//! - 实体不存在时视为「创建」：以默认值落底，再应用 patch（upsert 语义）；
//! - 墓碑即普通字段：只有显式 `deleted` 字段能改变删除状态，
//!   对墓碑的其他字段编辑不会「复活」实体。

use crate::model::{Id, Patch, ProjectPatch, ProjectRecord, Set, TaskPatch, TaskRecord};
use std::collections::HashMap;

pub const DEFAULT_PROJECT_COLOR: &str = "gray";
pub const DEFAULT_PRIORITY: i32 = 0;

/// 新项目记录的默认值（创建 = 默认值落底 + patch）。
pub fn project_defaults(id: &Id) -> ProjectRecord {
    ProjectRecord {
        id: id.clone(),
        name: String::new(),
        color: DEFAULT_PROJECT_COLOR.into(),
        sort_order: 0.0,
        deleted: false,
    }
}

/// 新任务记录的默认值。
pub fn task_defaults(id: &Id) -> TaskRecord {
    TaskRecord {
        id: id.clone(),
        project_id: String::new(),
        title: String::new(),
        notes: String::new(),
        due_date: None,
        priority: DEFAULT_PRIORITY,
        completed: false,
        labels: Vec::new(),
        sort_order: 0.0,
        deleted: false,
        parent_id: String::new(),
        recurrence: None,
    }
}

/// 记录级合并：服务端 SQL 投影与客户端存储各自落地时必须复用同一语义。
pub fn apply_project_record(rec: &mut ProjectRecord, patch: &ProjectPatch) {
    if let Some(v) = &patch.name {
        rec.name = v.clone();
    }
    if let Some(v) = &patch.color {
        rec.color = v.clone();
    }
    if let Some(v) = patch.sort_order {
        rec.sort_order = v;
    }
    if let Some(v) = patch.deleted {
        rec.deleted = v;
    }
}

/// 记录级合并（任务）。
#[allow(clippy::collapsible_if)]
pub fn apply_task_record(rec: &mut TaskRecord, patch: &TaskPatch) {
    if let Some(v) = &patch.project_id {
        rec.project_id = v.clone();
    }
    if let Some(v) = &patch.title {
        rec.title = v.clone();
    }
    if let Some(v) = &patch.notes {
        rec.notes = v.clone();
    }
    if let Some(v) = patch.due_date {
        rec.due_date = match v {
            Set::Clear => None,
            Set::Value(ts) => Some(ts),
        };
    }
    if let Some(v) = patch.priority {
        rec.priority = v;
    }
    if let Some(v) = patch.completed {
        rec.completed = v;
    }
    if let Some(v) = &patch.labels {
        rec.labels = v.clone();
    }
    if let Some(v) = patch.sort_order {
        rec.sort_order = v;
    }
    if let Some(v) = patch.deleted {
        rec.deleted = v;
    }
    if let Some(v) = &patch.recurrence {
        rec.recurrence = match v {
            Set::Clear => None,
            Set::Value(rule) => Some(rule.clone()),
        };
    }
    if let Some(v) = &patch.parent_id {
        rec.parent_id = match v {
            Set::Clear => String::new(),
            Set::Value(id) => id.clone(),
        };
    }
}

/// 应用项目 patch（实体不存在则先以默认值创建）。
pub fn apply_project(projects: &mut HashMap<Id, ProjectRecord>, id: &Id, patch: &ProjectPatch) {
    let r = projects
        .entry(id.clone())
        .or_insert_with(|| project_defaults(id));
    apply_project_record(r, patch);
}

/// 应用任务 patch（实体不存在则先以默认值创建）。
pub fn apply_task(tasks: &mut HashMap<Id, TaskRecord>, id: &Id, patch: &TaskPatch) {
    let r = tasks.entry(id.clone()).or_insert_with(|| task_defaults(id));
    apply_task_record(r, patch);
}

/// 彻底删除任务：从投影中移除记录本身（与软删墓碑正交）。实体不存在时为幂等 no-op。
pub fn forget_task(tasks: &mut HashMap<Id, TaskRecord>, id: &Id) {
    tasks.remove(id);
}

/// 便捷入口：按 `Patch` 分发。
pub fn apply_patch(
    projects: &mut HashMap<Id, ProjectRecord>,
    tasks: &mut HashMap<Id, TaskRecord>,
    entity_id: &Id,
    patch: &Patch,
) {
    match patch {
        Patch::Project(p) => apply_project(projects, entity_id, p),
        Patch::Task(p) => apply_task(tasks, entity_id, p),
        Patch::TaskForget => forget_task(tasks, entity_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_via_patch_materializes_defaults_then_applies() {
        let mut tasks = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                title: Some("买牛奶".into()),
                priority: Some(3),
                ..Default::default()
            },
        );
        let t = &tasks[&id];
        assert_eq!(t.title, "买牛奶");
        assert_eq!(t.priority, 3);
        assert!(!t.completed);
        assert!(!t.deleted);
        assert!(t.labels.is_empty());
        assert_eq!(t.due_date, None);
    }

    #[test]
    fn absent_fields_untouched_and_clear_wipes() {
        let mut tasks = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                title: Some("买牛奶".into()),
                due_date: Some(Set::Value(1_700_000_000_000)),
                ..Default::default()
            },
        );
        // 只改 completed，不动 due_date
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        );
        assert_eq!(tasks[&id].due_date, Some(1_700_000_000_000));
        assert!(tasks[&id].completed);
        // Clear 清空 due_date，title 不动
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                due_date: Some(Set::Clear),
                ..Default::default()
            },
        );
        assert_eq!(tasks[&id].due_date, None);
        assert_eq!(tasks[&id].title, "买牛奶");
    }

    #[test]
    fn tombstone_not_revived_by_unrelated_edit() {
        let mut tasks = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                title: Some("A".into()),
                ..Default::default()
            },
        );
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                deleted: Some(true),
                ..Default::default()
            },
        );
        // 对墓碑改 title：title 变了，但仍是墓碑
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                title: Some("B".into()),
                ..Default::default()
            },
        );
        let t = &tasks[&id];
        assert!(t.deleted);
        assert_eq!(t.title, "B");
        // 显式复活
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                deleted: Some(false),
                ..Default::default()
            },
        );
        assert!(!tasks[&id].deleted);
    }

    #[test]
    fn field_level_independence_comutes() {
        // 两个 op 改不同字段：任意顺序应用，结果一致
        let mut s1 = HashMap::new();
        let mut s2 = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut s1,
            &id,
            &TaskPatch {
                title: Some("T".into()),
                ..Default::default()
            },
        );
        apply_task(
            &mut s1,
            &id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        );
        apply_task(
            &mut s2,
            &id,
            &TaskPatch {
                completed: Some(true),
                ..Default::default()
            },
        );
        apply_task(
            &mut s2,
            &id,
            &TaskPatch {
                title: Some("T".into()),
                ..Default::default()
            },
        );
        assert_eq!(s1, s2);
    }

    #[test]
    fn same_field_lww_follows_apply_order() {
        let mut s = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut s,
            &id,
            &TaskPatch {
                title: Some("先到".into()),
                ..Default::default()
            },
        );
        apply_task(
            &mut s,
            &id,
            &TaskPatch {
                title: Some("后到".into()),
                ..Default::default()
            },
        );
        assert_eq!(s[&id].title, "后到");
    }

    #[test]
    fn forget_removes_entity_and_is_idempotent() {
        let mut tasks = HashMap::new();
        let id = "id-1".to_string();
        apply_task(
            &mut tasks,
            &id,
            &TaskPatch {
                title: Some("A".into()),
                deleted: Some(true),
                ..Default::default()
            },
        );
        forget_task(&mut tasks, &id);
        assert!(!tasks.contains_key(&id));
        // 重复 forget / 对不存在的实体 forget：均为幂等 no-op
        forget_task(&mut tasks, &id);
        forget_task(&mut tasks, &"id-404".to_string());
        assert!(tasks.is_empty());
    }
}
