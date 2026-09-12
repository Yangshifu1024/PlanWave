//! oplog 的数据模型：op、实体 patch、字段更新三态与投影记录。
//!
//! JSON 形状与前端 TypeScript 侧（packages/client-core）严格对齐，
//! 任何改动必须同步更新两端与 `tests/json_interop.rs` 中的字面量用例。

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// 实体 id：UUID v4 字符串（小写连字符形式）。
pub type Id = String;

/// 单字段更新三态：
/// - `Option::None`            —— JSON 里缺省，字段不动；
/// - `Some(Set::Clear)`        —— JSON `null`，清空字段；
/// - `Some(Set::Value(v))`     —— JSON 值本身，设置为 v。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Set<T> {
    Clear,
    Value(T),
}

impl<T> Set<T> {
    pub fn map<U, F: FnOnce(T) -> U>(self, f: F) -> Set<U> {
        match self {
            Set::Clear => Set::Clear,
            Set::Value(v) => Set::Value(f(v)),
        }
    }
}

// serde：Clear 序列化为 null；Value 序列化为值本身。
mod set_serde {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    impl<T: Serialize> Serialize for super::Set<T> {
        fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
            match self {
                super::Set::Clear => serializer.serialize_none(),
                super::Set::Value(v) => v.serialize(serializer),
            }
        }
    }

    impl<'de, T: Deserialize<'de>> Deserialize<'de> for super::Set<T> {
        fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
            let v = serde_json::Value::deserialize(deserializer)?;
            if v.is_null() {
                Ok(super::Set::Clear)
            } else {
                T::deserialize(v)
                    .map(super::Set::Value)
                    .map_err(serde::de::Error::custom)
            }
        }
    }
}

/// 项目（清单）字段 patch。字段缺省 = 不动；`deleted` 即墓碑。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ProjectPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

/// 任务字段 patch。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TaskPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    /// 截止时间（UTC 毫秒时间戳）。None=不动，Clear=清空，Value=设置。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<Set<i64>>,
    /// 0=无 1=低 2=中 3=高
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub labels: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted: Option<bool>,
}

/// op 携带的变更体：由实体类型决定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Patch {
    Project(ProjectPatch),
    Task(TaskPatch),
}

impl Patch {
    /// patch 是否没有携带任何字段变更（视为无效 op，拒绝入日志）。
    pub fn is_empty(&self) -> bool {
        match self {
            Patch::Project(p) => *p == ProjectPatch::default(),
            Patch::Task(p) => *p == TaskPatch::default(),
        }
    }
}

/// 一条同步操作。`op_id` 全局唯一保证幂等；`lamport` 为产生端逻辑时钟。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Op {
    pub op_id: Id,
    pub device_id: String,
    pub lamport: u64,
    pub entity_id: Id,
    pub patch: Patch,
    /// 产生时间（UTC 毫秒），仅作观测用途，不参与排序/合并。
    pub client_time_ms: i64,
}

impl Op {
    /// 客户端构造本地 op 的唯一入口：生成 op_id 并记录当前时间。
    pub fn new(device_id: &str, lamport: u64, entity_id: Id, patch: Patch) -> Self {
        Self {
            op_id: Uuid::new_v4().to_string(),
            device_id: device_id.to_string(),
            lamport,
            entity_id,
            patch,
            client_time_ms: now_ms(),
        }
    }

    pub fn validate(&self) -> Result<(), SyncError> {
        if Uuid::parse_str(&self.op_id).is_err() {
            return Err(SyncError::InvalidOp(format!(
                "op_id 不是合法 UUID: {}",
                self.op_id
            )));
        }
        if self.device_id.trim().is_empty() {
            return Err(SyncError::InvalidOp("device_id 不能为空".into()));
        }
        if Uuid::parse_str(&self.entity_id).is_err() {
            return Err(SyncError::InvalidOp(format!(
                "entity_id 不是合法 UUID: {}",
                self.entity_id
            )));
        }
        if self.patch.is_empty() {
            return Err(SyncError::InvalidOp("patch 不能为空".into()));
        }
        Ok(())
    }
}

/// 服务端定序后的 op：`seq` 为全局单调序号，op 字段拍平在同一层。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SequencedOp {
    pub seq: u64,
    #[serde(flatten)]
    pub op: Op,
}

/// 客户端同步元数据（本地持久化）。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SyncMeta {
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub lamport: u64,
    #[serde(default)]
    pub last_pulled_seq: u64,
}

/// 服务端权威投影记录（与客户端本地记录字段一致）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub id: Id,
    pub name: String,
    pub color: String,
    pub sort_order: f64,
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TaskRecord {
    pub id: Id,
    pub project_id: Id,
    pub title: String,
    pub notes: String,
    pub due_date: Option<i64>,
    pub priority: i32,
    pub completed: bool,
    pub labels: Vec<String>,
    pub sort_order: f64,
    pub deleted: bool,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SyncError {
    #[error("{0}")]
    InvalidOp(String),
}

// wasm32-unknown-unknown 未实现 std::time：浏览器侧用 JS Date（仅观测用途，不参与合并）
#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> i64 {
    js_sys::Date::now() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_op() -> Op {
        Op {
            op_id: Uuid::new_v4().to_string(),
            device_id: "device-a".into(),
            lamport: 1,
            entity_id: Uuid::new_v4().to_string(),
            patch: Patch::Task(TaskPatch {
                title: Some("写周报".into()),
                ..Default::default()
            }),
            client_time_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn validate_accepts_well_formed_op() {
        assert_eq!(valid_op().validate(), Ok(()));
    }

    #[test]
    fn validate_rejects_bad_uuid_and_empty_patch() {
        let mut op = valid_op();
        op.op_id = "not-a-uuid".into();
        assert!(matches!(op.validate(), Err(SyncError::InvalidOp(_))));

        let mut op = valid_op();
        op.patch = Patch::Task(TaskPatch::default());
        assert!(matches!(op.validate(), Err(SyncError::InvalidOp(_))));

        let mut op = valid_op();
        op.device_id = "  ".into();
        assert!(matches!(op.validate(), Err(SyncError::InvalidOp(_))));
    }
}
