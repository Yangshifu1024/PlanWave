//! 路由组装。

pub mod auth_api;
pub mod dto;
pub mod sync_api;

use crate::AppState;
use axum::routing::{get, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;

/// 构建完整应用路由（main 与集成测试共用同一入口）。
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/auth/status", get(auth_api::status))
        .route("/auth/register", post(auth_api::register))
        .route("/auth/login", post(auth_api::login))
        .route("/auth/refresh", post(auth_api::refresh))
        .route("/sync/push", post(sync_api::push))
        .route("/sync/pull", get(sync_api::pull))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok" }))
}
