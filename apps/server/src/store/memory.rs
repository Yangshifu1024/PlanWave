//! 内存存储：本地开发 / API 集成测试 / E2E 用。语义与 MySQL 实现保持一致。

use super::{Account, Store, StoreError, StoreResult};
use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Mutex;
use sync_core::{
    apply_project_record, apply_task_record, project_defaults, task_defaults, Op, SequencedOp,
};

#[derive(Debug, Default)]
struct Data {
    account: Option<Account>,
    devices: HashMap<String, Option<String>>, // device_id -> name
    ops: Vec<SequencedOp>,
    op_index: HashMap<String, u64>, // op_id -> seq
    projects: HashMap<String, sync_core::ProjectRecord>,
    tasks: HashMap<String, sync_core::TaskRecord>,
}

#[derive(Debug)]
struct Guard {
    data: Mutex<Data>,
    next_seq: std::sync::atomic::AtomicU64,
}

#[derive(Clone)]
pub struct MemoryStore {
    guard: std::sync::Arc<Guard>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self {
            guard: std::sync::Arc::new(Guard {
                data: Mutex::new(Data::default()),
                next_seq: std::sync::atomic::AtomicU64::new(0),
            }),
        }
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Store for MemoryStore {
    async fn has_account(&self) -> StoreResult<bool> {
        Ok(self.guard.data.lock().unwrap().account.is_some())
    }

    async fn create_account(&self, username: &str, password_hash: &str) -> StoreResult<Account> {
        let mut data = self.guard.data.lock().unwrap();
        if let Some(existing) = &data.account {
            return Err(StoreError::Conflict(format!(
                "账号已存在（{}），PlanWave 为单用户设计",
                existing.username
            )));
        }
        let account = Account {
            id: uuid::Uuid::new_v4().to_string(),
            username: username.to_string(),
            password_hash: password_hash.to_string(),
        };
        data.account = Some(account.clone());
        Ok(account)
    }

    async fn get_account(&self) -> StoreResult<Option<Account>> {
        Ok(self.guard.data.lock().unwrap().account.clone())
    }

    async fn upsert_device(&self, device_id: &str, name: Option<&str>) -> StoreResult<()> {
        self.guard
            .data
            .lock()
            .unwrap()
            .devices
            .insert(device_id.to_string(), name.map(|s| s.to_string()));
        Ok(())
    }

    async fn touch_device(&self, device_id: &str) -> StoreResult<()> {
        let mut data = self.guard.data.lock().unwrap();
        if !data.devices.contains_key(device_id) {
            data.devices.insert(device_id.to_string(), None);
        }
        Ok(())
    }

    async fn push(&self, ops: &[Op]) -> StoreResult<Vec<u64>> {
        let mut data = self.guard.data.lock().unwrap();
        let mut seqs = Vec::with_capacity(ops.len());
        for op in ops {
            op.validate()?;
            if let Some(&existing) = data.op_index.get(&op.op_id) {
                seqs.push(existing);
                continue;
            }
            let seq = self
                .guard
                .next_seq
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1;
            // 应用到权威投影（与 sync-core 语义一致）
            match &op.patch {
                sync_core::Patch::Project(p) => {
                    let mut rec = data
                        .projects
                        .get(&op.entity_id)
                        .cloned()
                        .unwrap_or_else(|| project_defaults(&op.entity_id));
                    apply_project_record(&mut rec, p);
                    data.projects.insert(op.entity_id.clone(), rec);
                }
                sync_core::Patch::Task(p) => {
                    let mut rec = data
                        .tasks
                        .get(&op.entity_id)
                        .cloned()
                        .unwrap_or_else(|| task_defaults(&op.entity_id));
                    apply_task_record(&mut rec, p);
                    data.tasks.insert(op.entity_id.clone(), rec);
                }
            }
            data.op_index.insert(op.op_id.clone(), seq);
            data.ops.push(SequencedOp {
                seq,
                op: op.clone(),
            });
            seqs.push(seq);
        }
        Ok(seqs)
    }

    async fn pull(&self, since: u64, limit: u32) -> StoreResult<(Vec<SequencedOp>, u64)> {
        let data = self.guard.data.lock().unwrap();
        let latest = data.ops.last().map(|s| s.seq).unwrap_or(0);
        let ops: Vec<SequencedOp> = data
            .ops
            .iter()
            .filter(|s| s.seq > since)
            .take(limit as usize)
            .cloned()
            .collect();
        Ok((ops, latest))
    }

    async fn latest_seq(&self) -> StoreResult<u64> {
        Ok(self
            .guard
            .data
            .lock()
            .unwrap()
            .ops
            .last()
            .map(|s| s.seq)
            .unwrap_or(0))
    }

    async fn snapshot(&self) -> StoreResult<sync_core::Snapshot> {
        let data = self.guard.data.lock().unwrap();
        Ok(sync_core::Snapshot {
            seq: data.ops.last().map(|s| s.seq).unwrap_or(0),
            projects: data.projects.values().cloned().collect(),
            tasks: data.tasks.values().cloned().collect(),
        })
    }
}

// 供测试断言投影状态（仅内存实现提供）。
impl MemoryStore {
    pub fn debug_tasks(&self) -> HashMap<String, sync_core::TaskRecord> {
        self.guard.data.lock().unwrap().tasks.clone()
    }
}
