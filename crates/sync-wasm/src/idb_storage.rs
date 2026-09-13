//! IndexedDB 存储（`idb` crate）：PlanWave 客户端本地库。
//!
//! 对象仓库设计：
//! - `projects` / `tasks`：out-of-line key = 实体 id，value = 记录 JSON
//! - `pending_ops`：自增主键（保持 op 产生顺序），value = op JSON
//! - `seen_ops`：key = 已应用 op_id（远端/本地去重）
//! - `meta`：key = "sync"，value = 同步元数据 JSON
//! - `recent_ops`：自增主键环形日志，保留最近 RECENT_OPS_LIMIT 条 op
//!   （仅观测用途，同步详情页展示；v2 新增，老库 on_upgrade 无损迁移）
//!
//! 合并/去重语义与 sync-core 一致；本模块只负责持久化。
//! 拉取路径按「每页一个事务」批量应用：远端 op 的 kv 读写不再逐条开事务。

use async_trait::async_trait;
use idb::{Database, DatabaseEvent, Factory, ObjectStoreParams, TransactionMode};
use serde::{Deserialize, Serialize};
use sync_core::{
    apply_project_record, apply_task_record, project_defaults, task_defaults, ClientError,
    ClientStorage, Id, Op, Patch, ProjectRecord, SequencedOp, Snapshot, SyncMeta, TaskRecord,
};

const META_KEY: &str = "sync";
const DB_VERSION: u32 = 2;
/// 最近 op 环形日志容量。
const RECENT_OPS_LIMIT: usize = 100;

fn db_err(e: impl std::fmt::Display) -> ClientError {
    ClientError::Storage(e.to_string())
}

fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

/// 最近 op 日志条目（同步详情页展示用，不参与同步）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentOpEntry {
    /// "local"（本地产生）| "remote"（远端应用）
    pub dir: String,
    pub op_id: Id,
    pub entity_id: Id,
    pub lamport: u64,
    pub client_time_ms: i64,
    /// 远端应用时的服务端 seq；本地 op 尚无 seq。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq: Option<u64>,
    /// 本条日志的落库时间（UTC 毫秒）。
    pub at_ms: i64,
    pub patch: Patch,
}

impl RecentOpEntry {
    fn local(op: &Op) -> Self {
        Self {
            dir: "local".into(),
            op_id: op.op_id.clone(),
            entity_id: op.entity_id.clone(),
            lamport: op.lamport,
            client_time_ms: op.client_time_ms,
            seq: None,
            at_ms: now_ms(),
            patch: op.patch.clone(),
        }
    }

    fn remote(s: &SequencedOp) -> Self {
        Self {
            dir: "remote".into(),
            op_id: s.op.op_id.clone(),
            entity_id: s.op.entity_id.clone(),
            lamport: s.op.lamport,
            client_time_ms: s.op.client_time_ms,
            seq: Some(s.seq),
            at_ms: now_ms(),
            patch: s.op.patch.clone(),
        }
    }
}

#[derive(Debug)]
pub struct IdbStorage {
    db: Database,
}

impl IdbStorage {
    pub async fn open() -> Result<Self, ClientError> {
        let factory = Factory::new().map_err(db_err)?;
        let mut request = factory.open("planwave", Some(DB_VERSION)).map_err(db_err)?;
        request.on_upgrade_needed(|event| {
            if let Ok(db) = event.database() {
                // create_object_store 对已存在的仓库会抛错：v1→v2 升级时
                // 老仓库重复创建的报错被忽略，新仓库（recent_ops）正常创建。
                let _ = db.create_object_store("projects", ObjectStoreParams::new());
                let _ = db.create_object_store("tasks", ObjectStoreParams::new());
                let mut params = ObjectStoreParams::new();
                params.auto_increment(true);
                let _ = db.create_object_store("pending_ops", params);
                let _ = db.create_object_store("seen_ops", ObjectStoreParams::new());
                let _ = db.create_object_store("meta", ObjectStoreParams::new());
                let mut recent_params = ObjectStoreParams::new();
                recent_params.auto_increment(true);
                let _ = db.create_object_store("recent_ops", recent_params);
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

    /// 追加最近 op 日志并在同一事务里裁剪到容量上限。
    async fn append_recent(&self, entries: &[RecentOpEntry]) -> Result<(), ClientError> {
        if entries.is_empty() {
            return Ok(());
        }
        // 每页只留尾部 RECENT_OPS_LIMIT 条：批量应用时更早的条目没有观测价值
        let tail = if entries.len() > RECENT_OPS_LIMIT {
            &entries[entries.len() - RECENT_OPS_LIMIT..]
        } else {
            entries
        };
        let tx = self
            .db
            .transaction(&["recent_ops"], TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let store = tx.object_store("recent_ops").map_err(db_err)?;
        for entry in tail {
            let json =
                serde_json::to_string(entry).map_err(|e| ClientError::Storage(e.to_string()))?;
            store.put(&json.into(), None).map_err(db_err)?;
        }
        // 自增主键升序 = 时间升序：裁掉最老的
        let keys = store.get_all_keys(None, None).map_err(db_err)?.await;
        let keys = keys.map_err(db_err)?;
        let overflow = keys.len().saturating_sub(RECENT_OPS_LIMIT);
        for key in keys.into_iter().take(overflow) {
            store.delete(key).map_err(db_err)?;
        }
        tx.await.map_err(db_err)?;
        Ok(())
    }

    /// 供 UI 层读取（同步详情页）：按时间倒序返回最近 op。
    pub async fn recent_ops(&self, limit: u32) -> Result<Vec<RecentOpEntry>, ClientError> {
        let rows = self.kv_scan("recent_ops").await?;
        Ok(rows
            .iter()
            .rev()
            .take(limit as usize)
            .filter_map(|s| serde_json::from_str(s).ok())
            .collect())
    }

    pub async fn reset_local(&self) -> Result<(), ClientError> {
        for table in [
            "projects",
            "tasks",
            "pending_ops",
            "seen_ops",
            "meta",
            "recent_ops",
        ] {
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
    ///
    /// 性能：整页共用一个 IndexedDB 事务（此前每条 op 多次独立事务）；
    /// 游标按页内最大 seq 推进——含已 seen 的 op，否则自己 push 后 echo 回来的
    /// op 会卡住游标，每次刷新都重复拉取同一窗口。
    async fn apply_remote(&self, ops: &[SequencedOp]) -> Result<u32, ClientError> {
        if ops.is_empty() {
            return Ok(0);
        }
        let tables = ["projects", "tasks", "seen_ops", "recent_ops", "meta"];
        let tx = self
            .db
            .transaction(&tables, TransactionMode::ReadWrite)
            .map_err(db_err)?;
        let projects = tx.object_store("projects").map_err(db_err)?;
        let tasks = tx.object_store("tasks").map_err(db_err)?;
        let seen = tx.object_store("seen_ops").map_err(db_err)?;

        let mut applied = 0u32;
        let mut recent: Vec<RecentOpEntry> = Vec::new();
        let mut max_seq: Option<u64> = None;
        let mut max_lamport = 0u64;
        // 页内实体缓存：同一实体多条 op 只读一次
        let mut task_cache: std::collections::HashMap<Id, Option<TaskRecord>> =
            std::collections::HashMap::new();
        let mut project_cache: std::collections::HashMap<Id, Option<ProjectRecord>> =
            std::collections::HashMap::new();

        for s in ops {
            max_seq = Some(max_seq.unwrap_or(0).max(s.seq));
            max_lamport = max_lamport.max(s.op.lamport);
            let already = seen
                .get(wasm_bindgen::JsValue::from(&s.op.op_id))
                .map_err(db_err)?
                .await
                .map_err(db_err)?
                .is_some();
            if already {
                continue;
            }
            match &s.op.patch {
                Patch::Task(p) => {
                    let rec = match task_cache.remove(&s.op.entity_id) {
                        Some(cached) => cached,
                        None => {
                            let raw = tasks
                                .get(wasm_bindgen::JsValue::from(&s.op.entity_id))
                                .map_err(db_err)?
                                .await
                                .map_err(db_err)?
                                .and_then(|v| v.as_string());
                            raw.and_then(|s| serde_json::from_str::<TaskRecord>(&s).ok())
                        }
                    };
                    let mut rec = rec.unwrap_or_else(|| task_defaults(&s.op.entity_id));
                    apply_task_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    tasks
                        .put(&json.into(), Some(&s.op.entity_id.clone().into()))
                        .map_err(db_err)?;
                    task_cache.insert(s.op.entity_id.clone(), Some(rec));
                }
                Patch::Project(p) => {
                    let rec = match project_cache.remove(&s.op.entity_id) {
                        Some(cached) => cached,
                        None => {
                            let raw = projects
                                .get(wasm_bindgen::JsValue::from(&s.op.entity_id))
                                .map_err(db_err)?
                                .await
                                .map_err(db_err)?
                                .and_then(|v| v.as_string());
                            raw.and_then(|s| serde_json::from_str::<ProjectRecord>(&s).ok())
                        }
                    };
                    let mut rec = rec.unwrap_or_else(|| project_defaults(&s.op.entity_id));
                    apply_project_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    projects
                        .put(&json.into(), Some(&s.op.entity_id.clone().into()))
                        .map_err(db_err)?;
                    project_cache.insert(s.op.entity_id.clone(), Some(rec));
                }
            }
            seen.put(&"1".into(), Some(&s.op.op_id.clone().into()))
                .map_err(db_err)?;
            recent.push(RecentOpEntry::remote(s));
            applied += 1;
        }

        if applied > 0 {
            let meta_store = tx.object_store("meta").map_err(db_err)?;
            let raw: Option<String> = meta_store
                .get(wasm_bindgen::JsValue::from(META_KEY))
                .map_err(db_err)?
                .await
                .map_err(db_err)?
                .and_then(|v| v.as_string());
            let mut meta: SyncMeta = raw
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            if let Some(seq) = max_seq {
                if seq > meta.last_pulled_seq {
                    meta.last_pulled_seq = seq;
                }
            }
            if max_lamport > meta.lamport {
                meta.lamport = max_lamport;
            }
            let meta_json =
                serde_json::to_string(&meta).map_err(|e| ClientError::Storage(e.to_string()))?;
            meta_store
                .put(&meta_json.into(), Some(&META_KEY.into()))
                .map_err(db_err)?;
        }
        tx.await.map_err(db_err)?;
        self.append_recent(&recent).await?;
        Ok(applied)
    }

    /// 本地 op：立即应用 + 标记已见 + 入待推送队列 + 推进时钟。
    async fn apply_local(&self, op: &Op) -> Result<(), ClientError> {
        match &op.patch {
            Patch::Task(p) => {
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
            Patch::Project(p) => {
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
        self.append_recent(&[RecentOpEntry::local(op)]).await?;
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

    /// 快照引导：重置投影并写入服务端权威状态，推进游标。
    /// pending 队列/已见集合/设备标识/时钟全部保留，且 pending 中的 op
    /// 会重新应用到投影——本地未同步的编辑在引导后依然可见。
    async fn reset_with_snapshot(&self, snap: &Snapshot) -> Result<(), ClientError> {
        self.kv_clear("projects").await?;
        self.kv_clear("tasks").await?;
        for chunk in snap.projects.chunks(500) {
            let tx = self
                .db
                .transaction(&["projects"], TransactionMode::ReadWrite)
                .map_err(db_err)?;
            let store = tx.object_store("projects").map_err(db_err)?;
            for rec in chunk {
                let json =
                    serde_json::to_string(rec).map_err(|e| ClientError::Storage(e.to_string()))?;
                store
                    .put(&json.into(), Some(&rec.id.clone().into()))
                    .map_err(db_err)?;
            }
            tx.await.map_err(db_err)?;
        }
        for chunk in snap.tasks.chunks(500) {
            let tx = self
                .db
                .transaction(&["tasks"], TransactionMode::ReadWrite)
                .map_err(db_err)?;
            let store = tx.object_store("tasks").map_err(db_err)?;
            for rec in chunk {
                let json =
                    serde_json::to_string(rec).map_err(|e| ClientError::Storage(e.to_string()))?;
                store
                    .put(&json.into(), Some(&rec.id.clone().into()))
                    .map_err(db_err)?;
            }
            tx.await.map_err(db_err)?;
        }
        // 重新应用未推送的本地 op（不重复入队）
        let pending = self.pending().await?;
        for op in &pending {
            match &op.patch {
                Patch::Task(p) => {
                    let current: Option<TaskRecord> = self
                        .kv_get("tasks", &op.entity_id)
                        .await?
                        .and_then(|s| serde_json::from_str(&s).ok());
                    let mut rec = current.unwrap_or_else(|| task_defaults(&op.entity_id));
                    apply_task_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    self.kv_put("tasks", &op.entity_id, json).await?;
                }
                Patch::Project(p) => {
                    let current: Option<ProjectRecord> = self
                        .kv_get("projects", &op.entity_id)
                        .await?
                        .and_then(|s| serde_json::from_str(&s).ok());
                    let mut rec = current.unwrap_or_else(|| project_defaults(&op.entity_id));
                    apply_project_record(&mut rec, p);
                    let json = serde_json::to_string(&rec)
                        .map_err(|e| ClientError::Storage(e.to_string()))?;
                    self.kv_put("projects", &op.entity_id, json).await?;
                }
            }
        }
        let mut meta = self.read_meta().await?;
        if snap.seq > meta.last_pulled_seq {
            meta.last_pulled_seq = snap.seq;
        }
        self.write_meta(&meta).await
    }
}
