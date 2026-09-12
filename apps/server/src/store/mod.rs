//! 存储层抽象：内存实现（本地开发 / 测试 / E2E）与 MySQL 实现（生产）。
//!
//! push 的语义由 sync-core 的重放模型规定：
//! - 服务端只负责按到达顺序分配全局 `seq`（全序的唯一定序点）；
//! - `op_id` 重复时返回已存在的 seq（幂等）；
//! - 新 op 应用到权威投影表（projects/tasks），语义与 sync-core 的
//!   `apply_patch` 逐字段一致。

pub mod memory;
pub mod mysql;

pub use memory::MemoryStore;
pub use mysql::MySqlStore;

use async_trait::async_trait;
use sync_core::{Op, SequencedOp};

#[derive(Debug, Clone, serde::Serialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    pub password_hash: String,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("冲突: {0}")]
    Conflict(String),
    #[error("无效 op: {0}")]
    InvalidOp(String),
    #[error("存储错误: {0}")]
    Db(String),
}

impl From<sync_core::SyncError> for StoreError {
    fn from(e: sync_core::SyncError) -> Self {
        StoreError::InvalidOp(e.to_string())
    }
}

pub type StoreResult<T> = Result<T, StoreError>;

#[async_trait]
pub trait Store: Send + Sync + 'static {
    // ---- 账号（单用户：至多一行） ----
    async fn has_account(&self) -> StoreResult<bool>;
    async fn create_account(&self, username: &str, password_hash: &str) -> StoreResult<Account>;
    async fn get_account(&self) -> StoreResult<Option<Account>>;

    // ---- 设备 ----
    async fn upsert_device(&self, device_id: &str, name: Option<&str>) -> StoreResult<()>;
    async fn touch_device(&self, device_id: &str) -> StoreResult<()>;

    // ---- oplog ----
    /// 批量原子 push：为新 op 分配 seq，重复 op 返回既有 seq。
    /// 返回与输入一一对应的 seq 列表。
    async fn push(&self, ops: &[Op]) -> StoreResult<Vec<u64>>;
    /// 拉取 (since, since+limit] 的定序 op 与当前 latest_seq。
    async fn pull(&self, since: u64, limit: u32) -> StoreResult<(Vec<SequencedOp>, u64)>;
    async fn latest_seq(&self) -> StoreResult<u64>;
}

/// 按环境变量选择存储实现；DATABASE_URL 缺省时用内存存储。
pub async fn from_env(database_url: Option<String>) -> Result<std::sync::Arc<dyn Store>, String> {
    match database_url {
        Some(url) => {
            let s = mysql::MySqlStore::connect(&url)
                .await
                .map_err(|e| format!("连接 MySQL 失败: {e}"))?;
            Ok(std::sync::Arc::new(s))
        }
        None => {
            tracing::warn!("未设置 DATABASE_URL，使用内存存储（重启即清空，仅供开发/测试）");
            Ok(std::sync::Arc::new(memory::MemoryStore::new()))
        }
    }
}
