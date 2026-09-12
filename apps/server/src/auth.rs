//! JWT（HS256）签发/校验、argon2id 密码哈希与 Bearer 鉴权提取器。

use crate::error::ApiError;
use crate::AppState;
use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

pub const TOKEN_TYPE_ACCESS: &str = "access";
pub const TOKEN_TYPE_REFRESH: &str = "refresh";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// 账号 id
    pub sub: String,
    /// access | refresh
    pub typ: String,
    pub device_id: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn sign_token(secret: &str, claims: &Claims) -> Result<String, ApiError> {
    jsonwebtoken::encode(
        &Header::default(),
        claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| ApiError::Internal(format!("token 签发失败: {e}")))
}

pub fn decode_token(secret: &str, token: &str) -> Result<Claims, ApiError> {
    let data = jsonwebtoken::decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized("token 无效或已过期".into()))?;
    Ok(data.claims)
}

pub fn issue_tokens(
    state: &AppState,
    account_id: &str,
    device_id: &str,
) -> Result<crate::api::dto::TokenPair, ApiError> {
    let now = now_secs();
    let access = sign_token(
        &state.jwt_secret,
        &Claims {
            sub: account_id.into(),
            typ: TOKEN_TYPE_ACCESS.into(),
            device_id: device_id.into(),
            iat: now,
            exp: now + state.access_minutes * 60,
        },
    )?;
    let refresh = sign_token(
        &state.jwt_secret,
        &Claims {
            sub: account_id.into(),
            typ: TOKEN_TYPE_REFRESH.into(),
            device_id: device_id.into(),
            iat: now,
            exp: now + state.refresh_days * 86400,
        },
    )?;
    Ok(crate::api::dto::TokenPair {
        access_token: access,
        refresh_token: refresh,
        expires_in: state.access_minutes * 60,
    })
}

pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| ApiError::Internal(format!("密码哈希失败: {e}")))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).ok().is_some_and(|parsed| {
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
}

/// Bearer access token 鉴权提取器。
pub struct AuthUser {
    pub account_id: String,
    pub device_id: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .ok_or_else(|| ApiError::Unauthorized("缺少 Authorization 头".into()))?;
        let raw = header
            .to_str()
            .map_err(|_| ApiError::Unauthorized("Authorization 头格式错误".into()))?;
        let token = raw
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::Unauthorized("需要 Bearer token".into()))?;
        let claims = decode_token(&state.jwt_secret, token)?;
        if claims.typ != TOKEN_TYPE_ACCESS {
            return Err(ApiError::Unauthorized("需要 access token".into()));
        }
        Ok(AuthUser {
            account_id: claims.sub,
            device_id: claims.device_id,
        })
    }
}

pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
