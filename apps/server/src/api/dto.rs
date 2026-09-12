//! API 请求/响应 DTO。

use serde::{Deserialize, Serialize};
use sync_core::Op;

// ---------- 鉴权 ----------

#[derive(Debug, Deserialize)]
pub struct RegisterReq {
    pub username: String,
    pub password: String,
    pub device_id: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
    pub device_id: String,
    pub device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RefreshReq {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    /// access token 有效期（秒）
    pub expires_in: i64,
}

#[derive(Debug, Serialize)]
pub struct StatusRes {
    pub has_account: bool,
}

// ---------- 同步 ----------

#[derive(Debug, Deserialize)]
pub struct PushReq {
    pub device_id: String,
    pub ops: Vec<Op>,
}

#[derive(Debug, Serialize)]
pub struct AppliedOp {
    pub op_id: String,
    pub seq: u64,
}

#[derive(Debug, Serialize)]
pub struct PushRes {
    pub applied: Vec<AppliedOp>,
    pub latest_seq: u64,
}

#[derive(Debug, Deserialize)]
pub struct PullQuery {
    pub since: u64,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct PullRes {
    pub ops: Vec<sync_core::SequencedOp>,
    pub latest_seq: u64,
    pub has_more: bool,
}
