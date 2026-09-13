//! MySQL 8.0 存储（sqlx，运行时查询）：生产实现。
//!
//! push 在单事务内完成：oplog 追加 + 权威投影 upsert。
//! 投影更新方式为「SELECT 当前行 FOR UPDATE → 默认值落底 →
//! sync-core 的记录级合并 → 全量写回」，保证与重放模型语义一致。

use super::{Account, Store, StoreError, StoreResult};
use async_trait::async_trait;
use sync_core::{
    apply_project_record, apply_task_record, project_defaults, task_defaults, Op, Patch,
    ProjectRecord, SequencedOp, Snapshot, TaskRecord,
};

#[derive(Clone)]
pub struct MySqlStore {
    pool: sqlx::MySqlPool,
}

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: String,
    name: String,
    color: String,
    sort_order: f64,
    deleted: bool,
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: String,
    project_id: String,
    parent_id: String,
    title: String,
    notes: String,
    due_date: Option<i64>,
    priority: i32,
    completed: bool,
    labels: String,     // JSON 字符串
    recurrence: Option<String>, // JSON 字符串，NULL = 不重复
    sort_order: f64,
    deleted: bool,
}

impl From<ProjectRow> for ProjectRecord {
    fn from(r: ProjectRow) -> Self {
        ProjectRecord {
            id: r.id,
            name: r.name,
            color: r.color,
            sort_order: r.sort_order,
            deleted: r.deleted,
        }
    }
}

impl TryFrom<TaskRow> for TaskRecord {
    type Error = StoreError;
    fn try_from(r: TaskRow) -> Result<Self, Self::Error> {
        Ok(TaskRecord {
            id: r.id,
            project_id: r.project_id,
            title: r.title,
            notes: r.notes,
            due_date: r.due_date,
            priority: r.priority,
            completed: r.completed,
            labels: serde_json::from_str(&r.labels)
                .map_err(|e| StoreError::Db(format!("labels JSON 解析失败: {e}")))?,
            sort_order: r.sort_order,
            deleted: r.deleted,
            parent_id: r.parent_id,
            recurrence: r
                .recurrence
                .map(|s| {
                    serde_json::from_str(&s)
                        .map_err(|e| StoreError::Db(format!("recurrence JSON 解析失败: {e}")))
                })
                .transpose()?,
        })
    }
}

fn db(e: impl std::fmt::Display) -> StoreError {
    tracing::error!("MySQL 错误: {e}");
    StoreError::Db(e.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl MySqlStore {
    pub async fn connect(url: &str) -> Result<Self, sqlx::Error> {
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(8)
            .connect(url)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl Store for MySqlStore {
    async fn has_account(&self) -> StoreResult<bool> {
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM account")
            .fetch_one(&self.pool)
            .await
            .map_err(db)?;
        Ok(n > 0)
    }

    async fn create_account(&self, username: &str, password_hash: &str) -> StoreResult<Account> {
        if self.has_account().await? {
            return Err(StoreError::Conflict(
                "账号已存在，PlanWave 为单用户设计".into(),
            ));
        }
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO account (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(username)
        .bind(password_hash)
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(db)?;
        Ok(Account {
            id,
            username: username.to_string(),
            password_hash: password_hash.to_string(),
        })
    }

    async fn get_account(&self) -> StoreResult<Option<Account>> {
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, username, password_hash FROM account ORDER BY created_at LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(db)?;
        Ok(row.map(|(id, username, password_hash)| Account {
            id,
            username,
            password_hash,
        }))
    }

    async fn upsert_device(&self, device_id: &str, name: Option<&str>) -> StoreResult<()> {
        sqlx::query(
            "INSERT INTO devices (device_id, name, last_seen_ms) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE name = COALESCE(?, name), last_seen_ms = ?",
        )
        .bind(device_id)
        .bind(name)
        .bind(now_ms())
        .bind(name)
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(db)?;
        Ok(())
    }

    async fn touch_device(&self, device_id: &str) -> StoreResult<()> {
        sqlx::query(
            "INSERT INTO devices (device_id, name, last_seen_ms) VALUES (?, NULL, ?)
             ON DUPLICATE KEY UPDATE last_seen_ms = ?",
        )
        .bind(device_id)
        .bind(now_ms())
        .bind(now_ms())
        .execute(&self.pool)
        .await
        .map_err(db)?;
        Ok(())
    }

    async fn push(&self, ops: &[Op]) -> StoreResult<Vec<u64>> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let mut out = Vec::with_capacity(ops.len());
        for op in ops {
            op.validate()?;
            // 幂等：op_id 唯一，已存在则返回既有 seq
            let existing: Option<i64> = sqlx::query_scalar("SELECT seq FROM ops WHERE op_id = ?")
                .bind(&op.op_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(db)?;
            if let Some(seq) = existing {
                out.push(seq as u64);
                continue;
            }
            let patch_json = serde_json::to_string(&op.patch)
                .map_err(|e| StoreError::Db(format!("patch 序列化失败: {e}")))?;
            sqlx::query(
                "INSERT INTO ops (op_id, device_id, lamport, entity_id, patch, client_time_ms)
                 VALUES (?, ?, ?, ?, CAST(? AS JSON), ?)",
            )
            .bind(&op.op_id)
            .bind(&op.device_id)
            .bind(op.lamport as i64)
            .bind(&op.entity_id)
            .bind(&patch_json)
            .bind(op.client_time_ms)
            .execute(&mut *tx)
            .await
            .map_err(db)?;
            let seq: i64 = sqlx::query_scalar("SELECT seq FROM ops WHERE op_id = ?")
                .bind(&op.op_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(db)?;
            // 权威投影 upsert（读-合并-写回，锁定行）
            match &op.patch {
                Patch::Project(p) => {
                    let row: Option<ProjectRow> =
                        sqlx::query_as("SELECT id, name, color, sort_order, deleted FROM projects WHERE id = ? FOR UPDATE")
                            .bind(&op.entity_id)
                            .fetch_optional(&mut *tx)
                            .await
                            .map_err(db)?;
                    let mut rec = row
                        .map(ProjectRecord::from)
                        .unwrap_or_else(|| project_defaults(&op.entity_id));
                    apply_project_record(&mut rec, p);
                    sqlx::query(
                        "INSERT INTO projects (id, name, color, sort_order, deleted)
                         VALUES (?, ?, ?, ?, ?) AS new
                         ON DUPLICATE KEY UPDATE
                           name = new.name, color = new.color,
                           sort_order = new.sort_order, deleted = new.deleted",
                    )
                    .bind(&rec.id)
                    .bind(&rec.name)
                    .bind(&rec.color)
                    .bind(rec.sort_order)
                    .bind(rec.deleted)
                    .execute(&mut *tx)
                    .await
                    .map_err(db)?;
                }
                Patch::Task(p) => {
                    let row: Option<TaskRow> = sqlx::query_as(
                        // labels/recurrence 列是 JSON 类型：CAST 成 CHAR 才能按 String 解码（sqlx 类型兼容规则）
                        "SELECT id, project_id, parent_id, title, notes, due_date, priority, completed, CAST(labels AS CHAR) AS labels, CAST(recurrence AS CHAR) AS recurrence, sort_order, deleted
                         FROM tasks WHERE id = ? FOR UPDATE",
                    )
                    .bind(&op.entity_id)
                    .fetch_optional(&mut *tx)
                    .await
                    .map_err(db)?;
                    let mut rec = match row {
                        Some(r) => TaskRecord::try_from(r)?,
                        None => task_defaults(&op.entity_id),
                    };
                    apply_task_record(&mut rec, p);
                    let labels_json = serde_json::to_string(&rec.labels)
                        .map_err(|e| StoreError::Db(format!("labels 序列化失败: {e}")))?;
                    let recurrence_json = rec
                        .recurrence
                        .as_ref()
                        .map(serde_json::to_string)
                        .transpose()
                        .map_err(|e| StoreError::Db(format!("recurrence 序列化失败: {e}")))?;
                    sqlx::query(
                        "INSERT INTO tasks (id, project_id, parent_id, title, notes, due_date, priority, completed, labels, recurrence, sort_order, deleted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?) AS new
                         ON DUPLICATE KEY UPDATE
                           project_id = new.project_id, parent_id = new.parent_id, title = new.title, notes = new.notes,
                           due_date = new.due_date, priority = new.priority, completed = new.completed,
                           labels = new.labels, recurrence = new.recurrence,
                           sort_order = new.sort_order, deleted = new.deleted",
                    )
                    .bind(&rec.id)
                    .bind(&rec.project_id)
                    .bind(&rec.parent_id)
                    .bind(&rec.title)
                    .bind(&rec.notes)
                    .bind(rec.due_date)
                    .bind(rec.priority)
                    .bind(rec.completed)
                    .bind(&labels_json)
                    .bind(&recurrence_json)
                    .bind(rec.sort_order)
                    .bind(rec.deleted)
                    .execute(&mut *tx)
                    .await
                    .map_err(db)?;
                }
            }
            out.push(seq as u64);
        }
        tx.commit().await.map_err(db)?;
        Ok(out)
    }

    async fn pull(&self, since: u64, limit: u32) -> StoreResult<(Vec<SequencedOp>, u64)> {
        // lamport 列是 BIGINT UNSIGNED：sqlx 要求用 u64 解码（seq/client_time_ms 是有符号 BIGINT）
        let rows: Vec<(i64, String, String, u64, String, String, i64)> = sqlx::query_as(
            // patch 列是 JSON 类型：CAST 成 CHAR 才能按 String 解码（sqlx 类型兼容规则）
            "SELECT seq, op_id, device_id, lamport, entity_id, CAST(patch AS CHAR) AS patch, client_time_ms
             FROM ops WHERE seq > ? ORDER BY seq LIMIT ?",
        )
        .bind(since as i64)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(db)?;

        let mut ops = Vec::with_capacity(rows.len());
        for (seq, op_id, device_id, lamport, entity_id, patch_json, client_time_ms) in rows {
            let patch: Patch = serde_json::from_str(&patch_json)
                .map_err(|e| StoreError::Db(format!("patch JSON 解析失败: {e}")))?;
            ops.push(SequencedOp {
                seq: seq as u64,
                op: Op {
                    op_id,
                    device_id,
                    lamport,
                    entity_id,
                    patch,
                    client_time_ms,
                },
            });
        }
        let latest: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM ops")
            .fetch_one(&self.pool)
            .await
            .map_err(db)?;
        Ok((ops, latest as u64))
    }

    async fn latest_seq(&self) -> StoreResult<u64> {
        let latest: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM ops")
            .fetch_one(&self.pool)
            .await
            .map_err(db)?;
        Ok(latest as u64)
    }

    async fn snapshot(&self) -> StoreResult<Snapshot> {
        // 单事务：latest_seq 与投影读自同一一致性视图（InnoDB REPEATABLE READ）
        let mut tx = self.pool.begin().await.map_err(db)?;
        let latest: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(seq), 0) FROM ops")
            .fetch_one(&mut *tx)
            .await
            .map_err(db)?;
        let project_rows: Vec<ProjectRow> = sqlx::query_as(
            "SELECT id, name, color, sort_order, deleted FROM projects",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
        let task_rows: Vec<TaskRow> = sqlx::query_as(
            "SELECT id, project_id, parent_id, title, notes, due_date, priority, completed, CAST(labels AS CHAR) AS labels, CAST(recurrence AS CHAR) AS recurrence, sort_order, deleted
             FROM tasks",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db)?;
        tx.commit().await.map_err(db)?;

        let projects = project_rows.into_iter().map(ProjectRecord::from).collect();
        let mut tasks = Vec::with_capacity(task_rows.len());
        for row in task_rows {
            tasks.push(TaskRecord::try_from(row)?);
        }
        Ok(Snapshot {
            seq: latest as u64,
            projects,
            tasks,
        })
    }
}
