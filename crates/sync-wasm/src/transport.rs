//! HTTP 传输层（gloo-net）：/sync/push|pull + 鉴权（token 存 localStorage，401 自动刷新重试）。
//! 同时承担登录/注册/刷新等引导接口——认证与同步共用同一 HTTP 栈。

use async_trait::async_trait;
use gloo_net::http::{Request, Response};
use gloo_storage::Storage;
use serde::{Deserialize, Serialize};
use sync_core::{ClientError, Op, PullPage, PushAck, Snapshot, SyncTransport};

const TOKEN_KEY: &str = "planwave.tokens";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Clone)]
pub struct HttpTransport {
    api_base: String,
}

fn net_err(e: impl std::fmt::Display) -> ClientError {
    ClientError::Network(e.to_string())
}

fn tokens() -> Option<TokenPair> {
    gloo_storage::LocalStorage::get(TOKEN_KEY).ok()
}

fn save_tokens(tokens: &TokenPair) {
    let _ = gloo_storage::LocalStorage::set(TOKEN_KEY, tokens);
}

pub fn clear_tokens() {
    gloo_storage::LocalStorage::delete(TOKEN_KEY);
}

async fn refresh_tokens(api_base: &str) -> Result<bool, ClientError> {
    let Some(tokens) = tokens() else {
        return Ok(false);
    };
    let body = serde_json::json!({ "refresh_token": tokens.refresh_token });
    let resp = Request::post(&format!("{api_base}/auth/refresh"))
        .json(&body)
        .map_err(net_err)?
        .send()
        .await
        .map_err(net_err)?;
    if !resp.ok() {
        clear_tokens();
        return Ok(false);
    }
    let pair: TokenPair = resp.json().await.map_err(net_err)?;
    save_tokens(&pair);
    Ok(true)
}

impl HttpTransport {
    pub fn new(api_base: String) -> Self {
        Self { api_base }
    }

    /// 发送带鉴权的 JSON 请求；401 时刷新 token 重试一次。
    async fn send_json<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        path: &str,
        body: Option<&(impl Serialize + ?Sized)>,
        allow_refresh: bool,
    ) -> Result<T, ClientError> {
        let stored = tokens();
        let auth = stored.as_ref().map(|t| t.access_token.clone());

        let mut resp = self.send_raw(method, path, auth.as_deref(), body).await?;

        if resp.status() == 401 && allow_refresh && refresh_tokens(&self.api_base).await? {
            let fresh = tokens();
            let auth = fresh.as_ref().map(|t| t.access_token.clone());
            resp = self.send_raw(method, path, auth.as_deref(), body).await?;
        }
        if !resp.ok() {
            // 优先透出服务端的业务错误文案（如「账号已存在…」），否则退回状态码
            let body = resp.text().await.unwrap_or_default();
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
            return Err(ClientError::Network(match detail {
                Some(msg) => msg,
                None => format!("HTTP {}", resp.status()),
            }));
        }
        resp.json().await.map_err(net_err)
    }

    async fn send_raw(
        &self,
        method: &str,
        path: &str,
        auth: Option<&str>,
        body: Option<&(impl Serialize + ?Sized)>,
    ) -> Result<Response, ClientError> {
        let url = format!("{}{path}", self.api_base);
        let builder = match method {
            "POST" => Request::post(&url),
            _ => Request::get(&url),
        };
        let builder = if let Some(token) = auth {
            builder.header("Authorization", &format!("Bearer {token}"))
        } else {
            builder
        };
        // GET 不能带 body：无 body 时直接从 builder 发送
        if let Some(b) = body {
            let request = builder.json(b).map_err(net_err)?;
            return request.send().await.map_err(net_err);
        }
        builder.send().await.map_err(net_err)
    }

    // ---- 引导接口（登录/注册/状态），供 PlanWaveClient 暴露给 UI ----

    pub async fn status(&self) -> Result<bool, ClientError> {
        #[derive(serde::Deserialize)]
        struct Res {
            has_account: bool,
        }
        let res: Res = self
            .send_json("GET", "/auth/status", None::<&()>, false)
            .await?;
        Ok(res.has_account)
    }

    pub async fn register(
        &self,
        username: &str,
        password: &str,
        device_id: &str,
        device_name: Option<&str>,
    ) -> Result<TokenPair, ClientError> {
        let body = serde_json::json!({
            "username": username,
            "password": password,
            "device_id": device_id,
            "device_name": device_name,
        });
        let pair: TokenPair = self
            .send_json("POST", "/auth/register", Some(&body), false)
            .await?;
        save_tokens(&pair);
        Ok(pair)
    }

    pub async fn login(
        &self,
        username: &str,
        password: &str,
        device_id: &str,
        device_name: Option<&str>,
    ) -> Result<TokenPair, ClientError> {
        let body = serde_json::json!({
            "username": username,
            "password": password,
            "device_id": device_id,
            "device_name": device_name,
        });
        let pair: TokenPair = self
            .send_json("POST", "/auth/login", Some(&body), false)
            .await?;
        save_tokens(&pair);
        Ok(pair)
    }

    pub fn logout(&self) {
        clear_tokens();
    }
}

#[async_trait(?Send)]
impl SyncTransport for HttpTransport {
    async fn push(&self, device_id: &str, ops: &[Op]) -> Result<PushAck, ClientError> {
        let body = serde_json::json!({ "device_id": device_id, "ops": ops });
        self.send_json("POST", "/sync/push", Some(&body), true)
            .await
    }

    async fn pull(&self, since: u64, limit: u32) -> Result<PullPage, ClientError> {
        self.send_json(
            "GET",
            &format!("/sync/pull?since={since}&limit={limit}"),
            None::<&()>,
            true,
        )
        .await
    }

    async fn snapshot(&self) -> Result<Snapshot, ClientError> {
        self.send_json("GET", "/sync/snapshot", None::<&()>, true)
            .await
    }
}
