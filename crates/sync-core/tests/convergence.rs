//! 随机化收敛性测试：任意一批 op 在任意全序下重放，
//! 只要「不同端重放的顺序一致」，最终状态必然一致（sync 协议的正确性核心）。

use rand::prelude::*;
use std::collections::HashMap;
use sync_core::{Op, Patch, ReplayState, SequencedOp, TaskPatch};
use uuid::Uuid;

/// 生成一批随机 task op（固定 seed，可复现）。
fn random_ops(seed: u64, entity_count: usize, op_count: usize) -> Vec<Op> {
    let mut rng = SmallRng::seed_from_u64(seed);
    let entities: Vec<String> = (0..entity_count)
        .map(|i| Uuid::from_u128(i as u128).to_string())
        .collect();
    (0..op_count)
        .map(|i| {
            let entity = entities[rng.random_range(0..entities.len())].clone();
            let field = rng.random_range(0..4);
            let patch = TaskPatch {
                title: (field == 0).then(|| format!("t{i}")),
                completed: (field == 1).then(|| rng.random_bool(0.5)),
                priority: (field == 2).then(|| rng.random_range(0..=3)),
                sort_order: (field == 3).then(|| rng.random::<f64>() * 1000.0),
                ..Default::default()
            };
            Op {
                // op_id 必须是合法 UUID：由 (seed, i) 确定性构造
                op_id: Uuid::from_u128(((seed as u128) << 64) | i as u128).to_string(),
                device_id: "fuzz".into(),
                lamport: i as u64,
                entity_id: entity,
                patch: Patch::Task(patch),
                client_time_ms: 0,
            }
        })
        .collect()
}

/// 用另一个等价但乱序的 op_id 集合重放：这里验证的是
/// 「相同全序 → 相同状态」以及重复投递的幂等性。
#[test]
fn same_order_converges_and_duplicates_are_idempotent() {
    for seed in 0..16u64 {
        let ops = random_ops(seed, 8, 120);
        let mut a = ReplayState::new();
        let mut b = ReplayState::new();

        // 链 1：顺序重放一遍，再原样重复投递一遍
        for (i, op) in ops.iter().enumerate() {
            a.apply(&SequencedOp {
                seq: i as u64 + 1,
                op: op.clone(),
            })
            .unwrap();
        }
        for (i, op) in ops.iter().enumerate() {
            let outcome = a.apply(&SequencedOp {
                seq: i as u64 + 1,
                op: op.clone(),
            });
            assert_eq!(outcome.unwrap(), sync_core::ApplyOutcome::Duplicate);
        }

        // 链 2：顺序重放 + 穿插重复
        for (i, op) in ops.iter().enumerate() {
            b.apply(&SequencedOp {
                seq: i as u64 + 1,
                op: op.clone(),
            })
            .unwrap();
            if i % 3 == 0 {
                b.apply(&SequencedOp {
                    seq: i as u64 + 1,
                    op: op.clone(),
                })
                .unwrap();
            }
        }

        assert_eq!(a.tasks, b.tasks, "seed={seed} 状态应收敛一致");
        assert_eq!(a.applied_count, ops.len() as u64);
    }
}

/// 乱序到达（seq 逆序批量到达后按 seq 排序重放）与顺序重放等价。
#[test]
fn out_of_order_arrival_sorted_by_seq_matches() {
    for seed in 0..16u64 {
        let ops = random_ops(seed, 6, 80);
        let mut shuffled: Vec<(u64, &Op)> = ops
            .iter()
            .enumerate()
            .map(|(i, op)| (i as u64 + 1, op))
            .collect();
        let mut rng = SmallRng::seed_from_u64(seed ^ 0xffff);
        shuffled.shuffle(&mut rng);

        let mut direct = ReplayState::new();
        for (seq, op) in ops.iter().enumerate() {
            direct
                .apply(&SequencedOp {
                    seq: seq as u64 + 1,
                    op: op.clone(),
                })
                .unwrap();
        }

        let mut buffered: Vec<SequencedOp> = shuffled
            .into_iter()
            .map(|(seq, op)| SequencedOp {
                seq,
                op: op.clone(),
            })
            .collect();
        buffered.sort_by_key(|s| s.seq);
        let mut replayed = ReplayState::new();
        for s in &buffered {
            replayed.apply(s).unwrap();
        }

        assert_eq!(direct.tasks, replayed.tasks, "seed={seed} 排序后重放应等价");
    }
}

/// 快照式的最终一致校验：重放后每个实体的字段值
/// 必须等于「该字段在最大 seq 的 op 中的值」（LWW 的直白定义）。
#[test]
fn final_state_matches_lww_definition() {
    let ops = random_ops(7, 5, 200);
    let mut state = ReplayState::new();
    for (i, op) in ops.iter().enumerate() {
        state
            .apply(&SequencedOp {
                seq: i as u64 + 1,
                op: op.clone(),
            })
            .unwrap();
    }

    // 逐字段求「最大 seq 的非空 patch 值」
    let mut expect_title: HashMap<String, (u64, String)> = HashMap::new();
    let mut expect_completed: HashMap<String, (u64, bool)> = HashMap::new();
    for (i, op) in ops.iter().enumerate() {
        let seq = i as u64 + 1;
        if let Patch::Task(p) = &op.patch {
            if let Some(t) = &p.title {
                expect_title.insert(op.entity_id.clone(), (seq, t.clone()));
            }
            if let Some(c) = p.completed {
                expect_completed.insert(op.entity_id.clone(), (seq, c));
            }
        }
    }
    for (id, (_, title)) in expect_title {
        assert_eq!(
            state.tasks[&id].title, title,
            "entity {id} 的 title 应为 LWW 值"
        );
    }
    for (id, (_, completed)) in expect_completed {
        assert_eq!(
            state.tasks[&id].completed, completed,
            "entity {id} 的 completed 应为 LWW 值"
        );
    }
}
