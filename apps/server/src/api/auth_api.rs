//! `/auth/*`：单账号注册 / 登录 / 刷新。

use super::dto::{LoginReq, RefreshReq, RegisterReq, StatusRes, TokenPair};
use crate::auth::{decode_token, hash_password, issue_tokens, verify_password, TOKEN_TYPE_REFRESH};
use crate::error::{ApiError, ApiResult};
use crate::AppState;
use axum::extract::State;
use axum::Json;

fn validate_credentials(username: &str, password: &str) -> Result<(), ApiError> {
    if username.trim().is_empty() {
        return Err(ApiError::Unprocessable("用户名不能为空".into()));
    }
    if username.trim().len() > 64 {
        return Err(ApiError::Unprocessable("用户名过长".into()));
    }
    if password.len() < 8 {
        return Err(ApiError::Unprocessable("密码至少 8 位".into()));
    }
    Ok(())
}

pub async fn status(State(state): State<AppState>) -> ApiResult<Json<StatusRes>> {
    Ok(Json(StatusRes {
        has_account: state.store.has_account().await?,
    }))
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterReq>,
) -> ApiResult<Json<TokenPair>> {
    validate_credentials(&req.username, &req.password)?;
    if state.store.has_account().await? {
        return Err(ApiError::Conflict(
            "账号已存在，PlanWave 为单用户设计，如需重置请清理数据库".into(),
        ));
    }
    let hash = hash_password(&req.password)?;
    let account = state
        .store
        .create_account(req.username.trim(), &hash)
        .await?;
    state
        .store
        .upsert_device(&req.device_id, req.device_name.as_deref())
        .await?;
    let pair = issue_tokens(&state, &account.id, &req.device_id)?;
    tracing::info!("账号已创建: {}", account.username);
    Ok(Json(pair))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginReq>,
) -> ApiResult<Json<TokenPair>> {
    let account = state.store.get_account().await?;
    let account = account.ok_or_else(|| ApiError::Unauthorized("账号不存在，请先初始化".into()))?;
    if account.username != req.username || !verify_password(&req.password, &account.password_hash) {
        return Err(ApiError::Unauthorized("用户名或密码错误".into()));
    }
    state
        .store
        .upsert_device(&req.device_id, req.device_name.as_deref())
        .await?;
    let pair = issue_tokens(&state, &account.id, &req.device_id)?;
    Ok(Json(pair))
}

/// 无状态刷新：校验 refresh token 后签发新对。
/// （设备级吊销属 v2 的设备管理功能，v1 不做服务端会话表。）
pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshReq>,
) -> ApiResult<Json<TokenPair>> {
    let claims = decode_token(&state.jwt_secret, &req.refresh_token)?;
    if claims.typ != TOKEN_TYPE_REFRESH {
        return Err(ApiError::Unauthorized("需要 refresh token".into()));
    }
    let pair = issue_tokens(&state, &claims.sub, &claims.device_id)?;
    Ok(Json(pair))
}
