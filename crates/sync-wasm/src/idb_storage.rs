//! IndexedDB 存储（`idb` crate）：PlanWave 客户端本地库。
//!
//! 对象仓库设计：
//! - `projects` / `tasks`：out-of-line key = 实体 id，value = 记录 JSON
//! - `pending_ops`：自增主键（保持 op 产生顺序），value = op JSON
//! - `seen_ops`：key = 已应用 op_id（远端/本地去重）
//! - `meta`：key = "sync"，value = 同步元数据 JSON
//!
//! 合并/去重语义与 sync-core 一致；本模块只负责持久化。

use async_trait::async_trait;
use idb::{Database, DatabaseEvent, Factory, ObjectStoreParams, TransactionMode};
use sync_core::{
    apply_project_record, apply_task_record, project_defaults, task_defaults, ClientError,
    ClientStorage, Id, Op, ProjectRecord, SequencedOp, SyncMeta, TaskRecord,
};

const META_KEY: &str = "sync";

fn db_err(e: impl std::fmt::Display) -> ClientError {
    ClientError::Storage(e.to_string())
}

#[derive(Debug)]
pub struct IdbStorage {
    db: Database,
}

impl IdbStorage {
    pub async fn open() -> Result<Self, ClientError> {
        let factory = Factory::new().map_err(db_err)?;
        let mut request = factory.open("planwave", Some(1)).map_err(db_err)?;
        request.on_upgrade_needed(|event| {
            if let Ok(db) = event.database() {
                let _ = db.create_object_store("projects", ObjectStoreParams::new());
                let _ = db.create_object_store("tasks", ObjectStoreParams::new());
                let mut params = ObjectStoreParams::new();
                params.auto_increment(true);
                let _ = db.create_object_store("pending_ops", params);
                let _ = db.create_object_store("seen_ops", ObjectStoreParams::new());
                let _ = db.create_object_store("meta", ObjectStoreParams::new());
            }
        });
        let db = request.await.map_err(db_err)?;
        Ok(Self { db })
    }

    async fn kv_get(&self, table: &str, key: &str) -> Result<Option<String>, ClientError> {
        let tx = self
            .db
            .transaction(&[table], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store(table).map_err(db_err)?;
        let value: Option<String> = store
            .get(wasm_bindgen::JsValue::from(key))
            .map_err(db_err)?
            .await
            .map_err(db_err)?
            .and_then(|v| v.as_string());
        Ok(value)
    }

    async fn kv_put(&self, table: &str, key: &str, value: String) -> Result<(), ClientError> {
        let tx = self
            .db
            .transaction(&[table], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store(table).map_err(db_err)?;
        store
            .put(&value.into(), Some(&key.into()))
            .map_err(db_err)?;
        tx.await.map_err(db_err)?;
        Ok(())
    }

    async fn kv_scan(&self, table: &str) -> Result<Vec<String>, ClientError> {
        let tx = self
            .db
            .transaction(&[table], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store(table).map_err(db_err)?;
        let values: Vec<String> = store
            .get_all(None, None)
            .map_err(db_err)?
            .await
            .map_err(db_err)?
            .into_iter()
            .filter_map(|v| v.as_string())
            .collect();
        Ok(values)
    }

    async fn kv_clear(&self, table: &str) -> Result<(), ClientError> {
        let tx = self
            .db
            .transaction(&[table], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store(table).map_err(db_err)?;
        store.clear().map_err(db_err)?;
        tx.await.map_err(db_err)?;
        Ok(())
    }

    async fn read_meta(&self) -> Result<SyncMeta, ClientError> {
        let raw = self.kv_get("meta", META_KEY).await?;
        Ok(raw
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default())
    }

    async fn write_meta(&self, meta: &SyncMeta) -> Result<(), ClientError> {
        let json = serde_json::to_string(meta).map_err(|e| ClientError::Storage(e.to_string()))?;
        self.kv_put("meta", META_KEY, json).await
    }

    async fn parse_pending(&self) -> Result<Vec<(i64, Op)>, ClientError> {
        let tx = self
            .db
            .transaction(&["pending_ops"], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store("pending_ops").map_err(db_err)?;
        let keys = store.get_all_keys(None, None).map_err(db_err)?.await;
        let values = store.get_all(None, None).map_err(db_err)?.await;
        tx.await.map_err(db_err)?;
        let keys = keys.map_err(db_err)?;
        let values = values.map_err(db_err)?;
        let mut out = Vec::with_capacity(keys.len());
        for (key, value) in keys.into_iter().zip(values) {
            // pending_ops 主键是自增数字（IndexedDB Number），不是字符串
            let seq = if let Some(s) = key.as_string() {
                s.parse::<i64>().unwrap_or(0)
            } else if let Some(n) = key.as_f64() {
                n as i64
            } else {
                continue;
            };
            let Some(value_str) = value.as_string() else {
                continue;
            };
            if let Ok(op) = serde_json::from_str::<Op>(&value_str) {
                out.push((seq, op));
            }
        }
        out.sort_by_key(|(k, _)| *k);
        Ok(out)
    }

    /// 供 UI 层读取（引擎不依赖）。
    pub async fn list_projects(&self) -> Result<Vec<ProjectRecord>, ClientError> {
        let rows = self.kv_scan("projects").await?;
        Ok(rows
            .iter()
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect())
    }

    pub async fn enqueue_local(&self, op_id: &str, op: &str) -> Result<(), ClientError> {
        for (_, existing) in self.parse_pending().await? {
            if existing.op_id == op_id {
                return Ok(());
            }
        }
        let tx = self
            .db
            .transaction(&["pending_ops"], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store("pending_ops").map_err(db_err)?;
        store.put(&op.into(), None).map_err(db_err)?;
        tx.await.map_err(db_err)?;
        Ok(())
    }

    pub async fn reset_local(&self) -> Result<(), ClientError> {
        for table in ["projects", "tasks", "pending_ops", "seen_ops", "meta"] {
            self.kv_clear(table).await?;
        }
        Ok(())
    }

    /// 供 UI 层读取（引擎不依赖）。
    pub async fn list_tasks(&self) -> Result<Vec<TaskRecord>, ClientError> {
        let rows = self.kv_scan("tasks").await?;
        Ok(rows
            .iter()
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect())
    }
}

#[async_trait(?Send)]
impl ClientStorage for IdbStorage {
    async fn meta(&self) -> Result<SyncMeta, ClientError> {
        self.read_meta().await
    }

    async fn set_meta(&self, meta: SyncMeta) -> Result<(), ClientError> {
        self.write_meta(&meta).await
    }

    /// 远端 op 应用：按 op_id 去重 + 字段级合并（与 sync-core 语义一致）。
    async fn apply_remote(&self, ops: &[SequencedOp]) -> Result<u32, ClientError> {
        let mut applied = 0u32;
        let mut fresh: Vec<String> = Vec::new();
        let mut max_seq: Option<u64> = None;
        let mut max_lamport = 0u64;
        for s in ops {
            if self.kv_get("seen_ops", &s.op.op_id).await?.is_some() {
                continue;
            }
            match &s.op.patch {
                sync_core::Patch::Task(p) => {
                    let current: Option<TaskRecord> = self
                        .kv_get("tasks", &s.op.entity_id)
                        .await?
                        .and_then(|s| serde_json::from_str(&s).ok());
                    let mut rec = current.unwrap_or_else(|| task_defaults(&s.op.entity_id));
                    apply_task_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    self.kv_put("tasks", &s.op.entity_id, json).await?;
                }
                sync_core::Patch::Project(p) => {
                    let current: Option<ProjectRecord> = self
                        .kv_get("projects", &s.op.entity_id)
                        .await?
                        .and_then(|s| serde_json::from_str(&s).ok());
                    let mut rec = current.unwrap_or_else(|| project_defaults(&s.op.entity_id));
                    apply_project_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    self.kv_put("projects", &s.op.entity_id, json).await?;
                }
            }
            self.kv_put("seen_ops", &s.op.op_id, "1".into()).await?;
            fresh.push(s.op.op_id.clone());
            applied += 1;
            max_seq = Some(max_seq.unwrap_or(0).max(s.seq));
            max_lamport = max_lamport.max(s.op.lamport);
        }
        if applied > 0 {
            let mut meta = self.read_meta().await?;
            if let Some(seq) = max_seq {
                if seq > meta.last_pulled_seq {
                    meta.last_pulled_seq = seq;
                }
            }
            if max_lamport > meta.lamport {
                meta.lamport = max_lamport;
            }
            self.write_meta(&meta).await?;
        }
        Ok(applied)
    }

    /// 本地 op：立即应用 + 标记已见 + 入待推送队列 + 推进时钟。
    async fn apply_local(&self, op: &Op) -> Result<(), ClientError> {
        match &op.patch {
            sync_core::Patch::Task(p) => {
                let current: Option<TaskRecord> = self
                    .kv_get("tasks", &op.entity_id)
                    .await?
                    .and_then(|s| serde_json::from_str(&s).ok());
                let mut rec = current.unwrap_or_else(|| task_defaults(&op.entity_id));
                apply_task_record(&mut rec, p);
                let json =
                    serde_json::to_string(&rec).map_err(|e| ClientError::Storage(e.to_string()))?;
                self.kv_put("tasks", &op.entity_id, json).await?;
            }
            sync_core::Patch::Project(p) => {
                let current: Option<ProjectRecord> = self
                    .kv_get("projects", &op.entity_id)
                    .await?
                    .and_then(|s| serde_json::from_str(&s).ok());
                let mut rec = current.unwrap_or_else(|| project_defaults(&op.entity_id));
                apply_project_record(&mut rec, p);
                let json =
                    serde_json::to_string(&rec).map_err(|e| ClientError::Storage(e.to_string()))?;
                self.kv_put("projects", &op.entity_id, json).await?;
            }
        }
        self.kv_put("seen_ops", &op.op_id, "1".into()).await?;
        let mut meta = self.read_meta().await?;
        if op.lamport > meta.lamport {
            meta.lamport = op.lamport;
            self.write_meta(&meta).await?;
        }
        let op_json = serde_json::to_string(op).map_err(|e| ClientError::Storage(e.to_string()))?;
        self.enqueue_local(&op.op_id, &op_json).await
    }

    async fn pending(&self) -> Result<Vec<Op>, ClientError> {
        Ok(self
            .parse_pending()
            .await?
            .into_iter()
            .map(|(_, op)| op)
            .collect())
    }

    async fn dequeue(&self, op_ids: &[Id]) -> Result<(), ClientError> {
        let ids: std::collections::HashSet<&Id> = op_ids.iter().collect();
        for (key, op) in self.parse_pending().await? {
            if ids.contains(&op.op_id) {
                let tx = self
                    .db
                    .transaction(&["pending_ops"], TransactionMode::ReadWrite)
                    .map_err(db_err)?;
                let store = tx.object_store("pending_ops").map_err(db_err)?;
                // IndexedDB 数字键是 JS Number：i64 须经 f64 转换（直接 From 会变成 BigInt，键匹配不上）
                store
                    .delete(wasm_bindgen::JsValue::from(key as f64))
                    .map_err(db_err)?;
                tx.await.map_err(db_err)?;
            }
        }
        Ok(())
    }
}
