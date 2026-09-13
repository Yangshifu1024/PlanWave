//! 全序重放引擎：按服务端 `seq` 顺序重放 op 集合，得到收敛状态。
//!
//! 这是 sync-core 的核心正确性模型：
//! - 服务端（MySQL 实现）和客户端（SQLite/Dexie 实现）各自落地存储，
//!   但「重放结果必须与这里一致」是所有端共同遵守的契约；
//! - `op_id` 去重保证重复投递幂等；
//! - 重放任意相同的 op 全序集合，任意两次得到的最终状态必然一致。

use crate::merge::apply_patch;
use crate::model::{Id, Op, ProjectRecord, SequencedOp, SyncError, TaskRecord};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApplyOutcome {
    /// 正常应用。
    Applied,
    /// `op_id` 已出现过，幂等跳过。
    Duplicate,
}

#[derive(Debug, Default, Clone)]
pub struct ReplayState {
    pub projects: HashMap<Id, ProjectRecord>,
    pub tasks: HashMap<Id, TaskRecord>,
    applied_op_ids: HashSet<Id>,
    /// 已应用的最大 seq。
    pub last_seq: u64,
    /// 已应用的 op 条数（不含重复）。
    pub applied_count: u64,
}

impl ReplayState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn seen_op(&self, op_id: &str) -> bool {
        self.applied_op_ids.contains(op_id)
    }

    /// 应用一条服务端定序后的 op。
    pub fn apply(&mut self, seq_op: &SequencedOp) -> Result<ApplyOutcome, SyncError> {
        seq_op.op.validate()?;
        if !self.applied_op_ids.insert(seq_op.op.op_id.clone()) {
            return Ok(ApplyOutcome::Duplicate);
        }
        self.apply_unchecked(&seq_op.op);
        self.last_seq = self.last_seq.max(seq_op.seq);
        self.applied_count += 1;
        Ok(ApplyOutcome::Applied)
    }

    /// 应用一条本地产生的 op（尚未定序）：本地立即生效，不入 seq 账本。
    pub fn apply_local(&mut self, op: &Op) -> Result<ApplyOutcome, SyncError> {
        op.validate()?;
        if !self.applied_op_ids.insert(op.op_id.clone()) {
            return Ok(ApplyOutcome::Duplicate);
        }
        self.apply_unchecked(op);
        self.applied_count += 1;
        Ok(ApplyOutcome::Applied)
    }

    fn apply_unchecked(&mut self, op: &Op) {
        apply_patch(
            &mut self.projects,
            &mut self.tasks,
            &op.entity_id,
            &op.patch,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Patch, TaskPatch};

    fn task_op(op_id: &str, entity_id: &str, title: &str) -> Op {
        Op {
            op_id: op_id.into(),
            device_id: "d1".into(),
            lamport: 1,
            entity_id: entity_id.into(),
            patch: Patch::Task(TaskPatch {
                title: Some(title.into()),
                ..Default::default()
            }),
            client_time_ms: 0,
        }
    }

    fn seq(seq_no: u64, op: Op) -> SequencedOp {
        SequencedOp { seq: seq_no, op }
    }

    fn forget_op(op_id: &str, entity_id: &str) -> Op {
        Op {
            op_id: op_id.into(),
            device_id: "d1".into(),
            lamport: 1,
            entity_id: entity_id.into(),
            patch: Patch::TaskForget,
            client_time_ms: 0,
        }
    }

    #[test]
    fn forget_removes_entity_in_total_order() {
        // upsert → forget：实体从回放状态中消失（与「服务端投影已删」的快照一致）
        let mut s = ReplayState::new();
        let entity = "e2a4b98f-5e64-4a5e-b3c3-9c19a8770004";
        s.apply(&seq(
            1,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0010", entity, "v1"),
        ))
        .unwrap();
        s.apply(&seq(
            2,
            forget_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0011", entity),
        ))
        .unwrap();
        assert!(!s.tasks.contains_key(entity));

        // forget 之后的编辑 op（如离线旧端迟到的推送）按 upsert 语义重建实体——
        // 这是全序回放既有语义的自然延伸，不是「复活」
        s.apply(&seq(
            3,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0012", entity, "v3"),
        ))
        .unwrap();
        assert_eq!(s.tasks[entity].title, "v3");
    }

    #[test]
    fn forget_unknown_entity_is_noop() {
        let mut s = ReplayState::new();
        s.apply(&seq(
            1,
            forget_op(
                "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0013",
                "e2a4b98f-5e64-4a5e-b3c3-9c19a8770005",
            ),
        ))
        .unwrap();
        assert!(s.tasks.is_empty());
        assert_eq!(s.applied_count, 1);
        assert_eq!(s.last_seq, 1);
    }

    #[test]
    fn replay_in_order_produces_lww_state() {
        let mut s = ReplayState::new();
        s.apply(&seq(
            1,
            task_op(
                "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0001",
                "e2a4b98f-5e64-4a5e-b3c3-9c19a8770001",
                "v1",
            ),
        ))
        .unwrap();
        s.apply(&seq(
            2,
            task_op(
                "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0002",
                "e2a4b98f-5e64-4a5e-b3c3-9c19a8770001",
                "v2",
            ),
        ))
        .unwrap();
        assert_eq!(s.tasks["e2a4b98f-5e64-4a5e-b3c3-9c19a8770001"].title, "v2");
        assert_eq!(s.last_seq, 2);
        assert_eq!(s.applied_count, 2);
    }

    #[test]
    fn duplicate_op_is_idempotent() {
        let mut s = ReplayState::new();
        let op = seq(
            1,
            task_op(
                "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0003",
                "e2a4b98f-5e64-4a5e-b3c3-9c19a8770001",
                "v1",
            ),
        );
        assert_eq!(s.apply(&op).unwrap(), ApplyOutcome::Applied);
        assert_eq!(s.apply(&op).unwrap(), ApplyOutcome::Duplicate);
        assert_eq!(s.applied_count, 1);
    }

    #[test]
    fn invalid_op_rejected_and_state_untouched() {
        let mut s = ReplayState::new();
        let op = task_op("not-a-uuid", "e2a4b98f-5e64-4a5e-b3c3-9c19a8770001", "v1");
        assert!(s.apply(&seq(1, op)).is_err());

        let mut op = task_op(
            "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0004",
            "e2a4b98f-5e64-4a5e-b3c3-9c19a8770001",
            "v1",
        );
        op.patch = Patch::Task(TaskPatch::default());
        assert!(s.apply(&seq(2, op)).is_err());
        assert!(s.tasks.is_empty());
        assert_eq!(s.applied_count, 0);
    }

    #[test]
    fn different_field_ops_converge_regardless_of_order() {
        // 改不同字段的 op：任意顺序应用，结果一致（字段级独立性）。
        let mut s1 = ReplayState::new();
        let mut s2 = ReplayState::new();
        let entity = "e2a4b98f-5e64-4a5e-b3c3-9c19a8770002";
        let op_title = task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0005", entity, "标题");
        let mut op_done = task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0006", entity, "标题");
        op_done.patch = Patch::Task(TaskPatch {
            completed: Some(true),
            ..Default::default()
        });
        let mut op_pri = task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0007", entity, "标题");
        op_pri.patch = Patch::Task(TaskPatch {
            priority: Some(3),
            ..Default::default()
        });

        s1.apply(&seq(1, op_title.clone())).unwrap();
        s1.apply(&seq(2, op_done.clone())).unwrap();
        s1.apply(&seq(3, op_pri.clone())).unwrap();

        s2.apply(&seq(1, op_pri)).unwrap();
        s2.apply(&seq(2, op_title)).unwrap();
        s2.apply(&seq(3, op_done)).unwrap();

        assert_eq!(s1.tasks, s2.tasks);
    }

    #[test]
    fn same_field_winner_follows_total_order() {
        // 同字段冲突由全序决胜：真实系统里全序由服务端唯一指定，
        // 因此所有端重放同一全序必得同一赢家。这里演示顺序反转即赢家反转。
        let mut s = ReplayState::new();
        let entity = "e2a4b98f-5e64-4a5e-b3c3-9c19a8770003";
        s.apply(&seq(
            1,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0008", entity, "先到"),
        ))
        .unwrap();
        s.apply(&seq(
            2,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0009", entity, "后到"),
        ))
        .unwrap();
        assert_eq!(s.tasks[entity].title, "后到");

        // 反转全序：赢家跟着反转
        let mut s2 = ReplayState::new();
        s2.apply(&seq(
            1,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0009", entity, "后到"),
        ))
        .unwrap();
        s2.apply(&seq(
            2,
            task_op("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c0008", entity, "先到"),
        ))
        .unwrap();
        assert_eq!(s2.tasks[entity].title, "先到");
    }
}
