//! 服务端配置：全部来自环境变量，带开发默认值。

#[derive(Debug, Clone)]
pub struct Config {
    /// MySQL 连接串；缺省时使用内存存储。
    pub database_url: Option<String>,
    pub listen: String,
    pub jwt_secret: String,
    pub access_token_minutes: i64,
    pub refresh_token_days: i64,
}

impl Config {
    pub fn from_env() -> Self {
        let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Self {
            database_url: env("DATABASE_URL"),
            listen: env("PLANWAVE_LISTEN").unwrap_or_else(|| "127.0.0.1:8787".into()),
            jwt_secret: env("PLANWAVE_JWT_SECRET").unwrap_or_else(|| "dev-only-change-me".into()),
            access_token_minutes: env("PLANWAVE_ACCESS_TOKEN_MINUTES")
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            refresh_token_days: env("PLANWAVE_REFRESH_TOKEN_DAYS")
                .and_then(|v| v.parse().ok())
                .unwrap_or(30),
        }
    }
}
