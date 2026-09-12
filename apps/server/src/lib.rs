//! PlanWave 同步服务端库入口（main 与集成测试共用）。

pub mod api;
pub mod auth;
pub mod config;
pub mod error;
pub mod store;

use std::sync::Arc;
use store::Store;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<dyn Store>,
    pub jwt_secret: Arc<String>,
    pub access_minutes: i64,
    pub refresh_days: i64,
}

impl AppState {
    pub fn new(
        store: Arc<dyn Store>,
        jwt_secret: &str,
        access_minutes: i64,
        refresh_days: i64,
    ) -> Self {
        Self {
            store,
            jwt_secret: Arc::new(jwt_secret.to_string()),
            access_minutes,
            refresh_days,
        }
    }
}
