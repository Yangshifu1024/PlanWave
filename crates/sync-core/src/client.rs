//! 客户端同步引擎（拉取式）：本地写即时生效 + pending 队列推送 + 手动/自动刷新拉取。
//!
//! 与 `replay` 的关系：replay 定义「服务端全序重放」的正确性模型；
//! client 定义「客户端如何产生/消费 op」——两者共享 `merge` 的字段级语义。
//!
//! 接收路径没有服务端推送通道，多端一致性由刷新保证：
//! - 自动：启动追平、push 成功后顺带拉取、前台定时轮询（定时器由绑定层驱动）
//! - 手动：`refresh()`
//!
//! 引擎不持有定时器与事件回调：防抖/轮询定时器由绑定层（sync-wasm）驱动，
//! `pull_in_progress`/`pull_again` 的单飞与尾随合并状态在本结构内。

use serde::{Deserialize, Serialize};

use crate::model::{Id, Op, Patch, SequencedOp, Snapshot, SyncMeta};
use std::cell::Cell;

/// 客户端本地存储抽象（由各端实现：WASM 端 IndexedDB、测试端内存）。
///
/// 契约与前端 TypeScript 侧的 LocalStore 一致：
/// - `apply_remote` 按 `op_id` 幂等去重，只应用未见过的 op；
/// - `apply_local` 立即应用并自动进入 pending 队列；
/// - `pending` 按产生顺序返回；
/// - `reset_with_snapshot` 只重置投影与游标，pending 队列与已见集合保留，
///   且必须把 pending 中的 op 重新应用到投影（本地未同步编辑在快照引导后仍可见）。
#[async_trait::async_trait(?Send)]
pub trait ClientStorage: std::fmt::Debug {
    async fn meta(&self) -> Result<SyncMeta, ClientError>;
    async fn set_meta(&self, meta: SyncMeta) -> Result<(), ClientError>;
    async fn apply_remote(&self, ops: &[SequencedOp]) -> Result<u32, ClientError>;
    async fn apply_local(&self, op: &Op) -> Result<(), ClientError>;
    async fn pending(&self) -> Result<Vec<Op>, ClientError>;
    async fn dequeue(&self, op_ids: &[Id]) -> Result<(), ClientError>;
    async fn reset_with_snapshot(&self, snap: &Snapshot) -> Result<(), ClientError>;
}

/// 与服务端的传输抽象（Axum 客户端实现；测试用内存假件）。
#[async_trait::async_trait(?Send)]
pub trait SyncTransport: std::fmt::Debug {
    async fn push(&self, device_id: &str, ops: &[Op]) -> Result<PushAck, ClientError>;
    async fn pull(&self, since: u64, limit: u32) -> Result<PullPage, ClientError>;
    /// 权威投影快照（新设备引导）。旧服务端不支持时返回错误，调用方回退全量回放。
    async fn snapshot(&self) -> Result<Snapshot, ClientError>;
}

/// 服务端 push 应答中单条 op 的落账记录（与 /sync/push 响应的 wire 格式一致）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AppliedOp {
    pub op_id: Id,
    pub seq: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushAck {
    /// 与输入一一对应的（op_id, seq）。
    pub applied: Vec<AppliedOp>,
    pub latest_seq: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PullPage {
    pub ops: Vec<SequencedOp>,
    pub latest_seq: u64,
    pub has_more: bool,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ClientError {
    #[error("网络错误: {0}")]
    Network(String),
    #[error("无效 op: {0}")]
    InvalidOp(String),
    #[error("存储错误: {0}")]
    Storage(String),
}

pub const PULL_PAGE_SIZE: u32 = 5000;
pub const MAX_OPS_PER_PUSH: usize = 500;

/// 同步客户端状态机。
pub struct Client<S: ClientStorage, T: SyncTransport> {
    storage: S,
    transport: T,
    pulling: Cell<bool>,
    pull_again: Cell<bool>,
}

impl<S: ClientStorage, T: SyncTransport> Client<S, T> {
    pub fn new(storage: S, transport: T) -> Self {
        Self {
            storage,
            transport,
            pulling: Cell::new(false),
            pull_again: Cell::new(false),
        }
    }

    /// 读取底层存储（UI 层查询任务/项目列表用）。
    pub fn storage(&self) -> &S {
        &self.storage
    }

    /// 应用启动：确保 device_id 存在并追平远端。
    ///
    /// 全新设备（游标为 0）优先走快照引导——一次请求拿到权威投影，
    /// 免去全量 oplog 分页回放；快照不可用（旧服务端/网络失败）自动回退。
    pub async fn start(&self) -> Result<SyncMeta, ClientError> {
        let mut meta = self.storage.meta().await?;
        if meta.device_id.is_empty() {
            meta.device_id = uuid::Uuid::new_v4().to_string();
            self.storage.set_meta(meta.clone()).await?;
        }
        if meta.last_pulled_seq == 0 {
            match self.transport.snapshot().await {
                Ok(snap) => {
                    self.storage.reset_with_snapshot(&snap).await?;
                    return self.storage.meta().await;
                }
                Err(_) => {
                    self.pull_all().await?;
                }
            }
        } else {
            self.pull_all().await?;
        }
        self.storage.meta().await
    }

    /// 本地变更唯一入口：立即应用到本地存储并入 pending 队列（推送由 `flush` 完成）。
    pub async fn mutate(&self, entity_id: Id, patch: Patch) -> Result<Op, ClientError> {
        let mut meta = self.storage.meta().await?;
        meta.lamport += 1;
        let op = Op::new(&meta.device_id, meta.lamport, entity_id, patch);
        self.storage.set_meta(meta).await?;
        self.storage.apply_local(&op).await?;
        Ok(op)
    }

    /// 刷新：先把本地积压推上去，再增量拉取。
    pub async fn refresh(&self) -> Result<u32, ClientError> {
        self.flush().await?;
        self.pull_all().await
    }

    /// 推送 pending 队列（分批），返回成功推送的 op 总数。
    /// 网络失败时保留剩余队列并返回 `ClientError::Network`（下次刷新重试）。
    pub async fn flush(&self) -> Result<usize, ClientError> {
        let meta = self.storage.meta().await?;
        let mut pushed = 0usize;
        loop {
            let ops = self.storage.pending().await?;
            if ops.is_empty() {
                return Ok(pushed);
            }
            let batch: Vec<Op> = ops.into_iter().take(MAX_OPS_PER_PUSH).collect();
            let ack = self.transport.push(&meta.device_id, &batch).await?;
            let acked: Vec<Id> = ack.applied.iter().map(|a| a.op_id.clone()).collect();
            self.storage.dequeue(&acked).await?;
            pushed += acked.len();
            if acked.len() < MAX_OPS_PER_PUSH {
                return Ok(pushed);
            }
        }
    }

    /// 按序号增量拉取，直到追平（分页）。返回累计实际应用条数。
    /// 并发语义：进行中时再次调用只置「尾随重拉」标记，结束后自动补一轮。
    pub async fn pull_all(&self) -> Result<u32, ClientError> {
        if self.pulling.get() {
            self.pull_again.set(true);
            return Ok(0);
        }
        self.pulling.set(true);
        let mut total = 0u32;
        let result = loop {
            match self.pull_loop().await {
                Err(e) => break Err(e),
                Ok(applied) => {
                    total += applied;
                    if self.pull_again.get() {
                        self.pull_again.set(false);
                        continue;
                    }
                    break Ok(total);
                }
            }
        };
        self.pulling.set(false);
        result
    }

    async fn pull_loop(&self) -> Result<u32, ClientError> {
        let mut applied_total = 0u32;
        loop {
            let meta = self.storage.meta().await?;
            let page = self
                .transport
                .pull(meta.last_pulled_seq, PULL_PAGE_SIZE)
                .await?;
            let applied = self.storage.apply_remote(&page.ops).await?;
            applied_total += applied;
            if !page.has_more {
                return Ok(applied_total);
            }
        }
    }
}
