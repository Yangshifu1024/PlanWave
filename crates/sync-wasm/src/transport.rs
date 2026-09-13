//! HTTP 传输层：/sync/push|pull + 鉴权（token 存 localStorage，401 自动刷新重试）。
//! 同时承担登录/注册/刷新等引导接口——认证与同步共用同一 HTTP 栈。
//!
//! 底层双通道：
//! - 桌面端（注册了 `__PW_FETCH` 桥）：请求经 Tauri 命令走原生 reqwest，
//!   设置弹框的代理档位对全部请求生效；
//! - Web/Android：gloo-net（浏览器 fetch），天然跟随系统代理。

use async_trait::async_trait;
use gloo_net::http::Request;
use gloo_storage::Storage;
use js_sys::{Function as JsFunction, Reflect};
use serde::{Deserialize, Serialize};
use sync_core::{ClientError, Op, PullPage, PushAck, Snapshot, SyncTransport};
use wasm_bindgen::JsValue;
use web_sys::window;

const TOKEN_KEY: &str = "planwave.tokens";
const BRIDGE_FN: &str = "__PW_FETCH";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
}

#[derive(Debug, Clone)]
pub struct HttpTransport {
    /// 共享句柄：Client 内的 transport 与 PlanWaveClient 持有的副本指向同一
    /// 地址，`set_api_base` 一处更新、两处生效（登录屏切换服务器用）。
    api_base: std::rc::Rc<std::cell::RefCell<String>>,
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

/// 底层 HTTP 响应（状态码 + 响应体文本）：桥与 gloo 两条路径统一到该结构。
struct RawResponse {
    status: u16,
    body: String,
}

/// 桌面端注册了 `__PW_FETCH` 桥时返回 true（此时 HTTP 走 Rust 原生通道，代理生效）。
fn bridge_available() -> bool {
    window()
        .map(|w| Reflect::has(&w, &JsValue::from_str(BRIDGE_FN)).unwrap_or(false))
        .unwrap_or(false)
}

/// 经 JS 桥发送请求（桥内部调用 Tauri 命令，按代理档位用原生 reqwest 执行）。
async fn bridge_fetch(
    method: &str,
    url: &str,
    auth: Option<&str>,
    body: Option<&serde_json::Value>,
) -> Result<RawResponse, ClientError> {
    let headers = match auth {
        Some(token) => serde_json::json!({ "Authorization": format!("Bearer {token}") }),
        None => serde_json::json!({}),
    };
    // body 序列化为字符串传输（Rust 侧 http_request 的 body 参数是 Option<String>）
    let body_str = match body {
        Some(v) => serde_json::to_string(v).map_err(net_err)?,
        None => String::new(),
    };
    let init = serde_json::json!({
        "method": method,
        "url": url,
        "headers": headers,
        "body": if body.is_some() { Some(body_str) } else { None },
    });
    let init_str = serde_json::to_string(&init).map_err(net_err)?;
    let window = window().ok_or_else(|| ClientError::Network("无窗口环境".into()))?;
    let func_val = Reflect::get(&window, &JsValue::from_str(BRIDGE_FN))
        .map_err(|e| ClientError::Network(format!("{e:?}")))?;
    if func_val.is_undefined() {
        return Err(ClientError::Network("代理桥不可用".into()));
    }
    let func: JsFunction = func_val.into();
    let promise_val = func
        .call1(&JsValue::NULL, &JsValue::from_str(&init_str))
        .map_err(|e| ClientError::Network(format!("桥调用失败: {e:?}")))?;
    let promise: js_sys::Promise = promise_val.into();
    let value = wasm_bindgen_futures::JsFuture::from(promise)
        .await
        .map_err(|e| ClientError::Network(format!("桥请求失败: {e:?}")))?;
    let text = value
        .as_string()
        .ok_or_else(|| ClientError::Network("桥返回非字符串".into()))?;
    let resp: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| ClientError::Network(e.to_string()))?;
    Ok(RawResponse {
        status: resp["status"].as_u64().unwrap_or(0) as u16,
        body: resp["body"].as_str().unwrap_or_default().to_string(),
    })
}

async fn refresh_tokens(api_base: &str) -> Result<bool, ClientError> {
    let Some(tokens) = tokens() else {
        return Ok(false);
    };
    let body = serde_json::json!({ "refresh_token": tokens.refresh_token });
    let transport = HttpTransport::new(api_base.to_string());
    let raw = transport
        .send_raw("POST", "/auth/refresh", None, Some(&body))
        .await?;
    if !(200..300).contains(&raw.status) {
        clear_tokens();
        return Ok(false);
    }
    let pair: TokenPair = serde_json::from_str(&raw.body).map_err(net_err)?;
    save_tokens(&pair);
    Ok(true)
}

impl HttpTransport {
    pub fn new(api_base: String) -> Self {
        Self {
            api_base: std::rc::Rc::new(std::cell::RefCell::new(api_base)),
        }
    }

    /// 运行时切换服务器地址（调用方须先清空 token 与本地库）。
    pub fn set_api_base(&self, api_base: String) {
        *self.api_base.borrow_mut() = api_base;
    }

    fn base(&self) -> String {
        self.api_base.borrow().clone()
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

        let mut raw = self.send_raw(method, path, auth.as_deref(), body).await?;

        if raw.status == 401 && allow_refresh && refresh_tokens(&self.base()).await? {
            let fresh = tokens();
            let auth = fresh.as_ref().map(|t| t.access_token.clone());
            raw = self.send_raw(method, path, auth.as_deref(), body).await?;
        }
        if !(200..300).contains(&raw.status) {
            // 优先透出服务端的业务错误文案（如「账号已存在…」），否则退回状态码
            let detail = serde_json::from_str::<serde_json::Value>(&raw.body)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
            return Err(ClientError::Network(match detail {
                Some(msg) => msg,
                None => format!("HTTP {}", raw.status),
            }));
        }
        serde_json::from_str(&raw.body).map_err(net_err)
    }

    /// 底层发送：桌面走 `__PW_FETCH` 桥（原生 reqwest，代理档位生效）；
    /// Web/Android 走浏览器 fetch（gloo-net，天然跟随系统代理）。
    async fn send_raw(
        &self,
        method: &str,
        path: &str,
        auth: Option<&str>,
        body: Option<&(impl Serialize + ?Sized)>,
    ) -> Result<RawResponse, ClientError> {
        let url = format!("{}{path}", self.base());
        let body_json: Option<serde_json::Value> = body
            .map(serde_json::to_value)
            .transpose()
            .map_err(net_err)?;

        // 桌面端：JS 桥已注册 → HTTP 经 Rust 原生通道（代理档位生效）
        if bridge_available() {
            return bridge_fetch(method, &url, auth, body_json.as_ref()).await;
        }

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
        let response = if let Some(b) = body_json {
            let request = builder.json(&b).map_err(net_err)?;
            request.send().await.map_err(net_err)?
        } else {
            builder.send().await.map_err(net_err)?
        };
        let status = response.status();
        let text = response.text().await.map_err(net_err)?;
        Ok(RawResponse { status, body: text })
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
