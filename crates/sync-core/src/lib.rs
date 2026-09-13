//! PlanWave 同步内核。
//!
//! 所有端（Axum 服务端、Tauri 客户端、Web 客户端）共用同一套 oplog 语义：
//!
//! 1. 客户端本地写：业务变更立即应用到本地存储，同时追加一条 pending op；
//! 2. op 由服务端按到达顺序分配全局单调 `seq`，形成全序；
//! 3. 所有端按 `seq` 全序重放同一 op 集合，得到必然一致（收敛）的最终状态；
//! 4. op 为实体级字段 patch：不同字段互不覆盖，同字段由全序决胜（field-level LWW）；
//! 5. 删除为软删除墓碑（`deleted: true`），只有显式 `deleted: false` 才能复活；
//! 6. `op_id` 全局唯一，重复投递幂等跳过。
//!
//! 本 crate 不做任何 IO，全部语义可纯函数级验证（见 `replay` 与测试）。

pub mod client;
pub mod clock;
pub mod merge;
pub mod model;
pub mod replay;

pub use client::{AppliedOp, Client, ClientError, ClientStorage, PullPage, PushAck, SyncTransport};
pub use clock::LamportClock;
pub use merge::{
    apply_patch, apply_project, apply_project_record, apply_task, apply_task_record,
    project_defaults, task_defaults,
};
pub use model::{
    Id, Op, Patch, ProjectPatch, ProjectRecord, RecurrenceFreq, RecurrenceRule, SequencedOp, Set,
    Snapshot, SyncError, SyncMeta, TaskPatch, TaskRecord,
};
pub use replay::{ApplyOutcome, ReplayState};
