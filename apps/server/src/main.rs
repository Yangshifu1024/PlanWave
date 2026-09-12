//! PlanWave 同步服务端启动入口。

use planwave_server::{api::build_router, config::Config, store, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,planwave_server=debug,tower_http=info")),
        )
        .init();

    let cfg = Config::from_env();
    let store = store::from_env(cfg.database_url.clone())
        .await
        .unwrap_or_else(|e| {
            eprintln!("存储初始化失败: {e}");
            std::process::exit(1);
        });
    let state = AppState::new(
        store,
        &cfg.jwt_secret,
        cfg.access_token_minutes,
        cfg.refresh_token_days,
    );
    let app = build_router(state);

    let listener = tokio::net::TcpListener::bind(&cfg.listen)
        .await
        .unwrap_or_else(|e| {
            eprintln!("监听 {} 失败: {e}", cfg.listen);
            std::process::exit(1);
        });
    tracing::info!("PlanWave server 已启动: http://{}", cfg.listen);
    axum::serve(listener, app).await.unwrap();
}
