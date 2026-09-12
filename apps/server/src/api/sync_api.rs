//! `/sync/*`：oplog 推送 / 拉取（拉取式同步：客户端以自动/手动刷新触发 pull，服务端无推送通道）。

use super::dto::{AppliedOp, PullQuery, PullRes, PushReq, PushRes};
use crate::auth::AuthUser;
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::{Query, State};
use axum::Json;
use sync_core::SyncError;

const MAX_OPS_PER_PUSH: usize = 5000;
const DEFAULT_PULL_LIMIT: u32 = 1000;
const MAX_PULL_LIMIT: u32 = 5000;

pub async fn push(
    State(state): State<AppState>,
    _user: AuthUser,
    Json(req): Json<PushReq>,
) -> ApiResult<Json<PushRes>> {
    if req.ops.len() > MAX_OPS_PER_PUSH {
        return Err(ApiError::Unprocessable(format!(
            "单次 push 最多 {MAX_OPS_PER_PUSH} 条 op"
        )));
    }
    // 批量原子：任何一个 op 非法则整体拒绝，不产生部分提交
    for op in &req.ops {
        op.validate()
            .map_err(|e: SyncError| ApiError::Unprocessable(e.to_string()))?;
    }
    let seqs = state.store.push(&req.ops).await?;
    state.store.touch_device(&req.device_id).await?;

    let latest = state.store.latest_seq().await?;
    let applied: Vec<AppliedOp> = req
        .ops
        .iter()
        .zip(&seqs)
        .map(|(op, seq)| AppliedOp {
            op_id: op.op_id.clone(),
            seq: *seq,
        })
        .collect();
    Ok(Json(PushRes {
        applied,
        latest_seq: latest,
    }))
}

pub async fn pull(
    State(state): State<AppState>,
    _user: AuthUser,
    Query(q): Query<PullQuery>,
) -> ApiResult<Json<PullRes>> {
    let limit = q
        .limit
        .unwrap_or(DEFAULT_PULL_LIMIT)
        .clamp(1, MAX_PULL_LIMIT);
    let (ops, latest) = state.store.pull(q.since, limit).await?;
    let has_more = q.since + (ops.len() as u64) < latest;
    Ok(Json(PullRes {
        ops,
        latest_seq: latest,
        has_more,
    }))
}
