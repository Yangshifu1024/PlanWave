//! 桌面端代理 HTTP 通道（设置弹框-网络）：同步引擎与更新请求的代理档位在此生效。
//!
//! - mode = none    直连（reqwest no_proxy，真绕过系统代理）
//! - mode = system  读取 OS 代理设置（sysproxy），未启用/读取失败 = 直连
//! - mode = custom  用户自定义 http/https/socks5 代理

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

/// 按代理配置缓存的 reqwest 客户端（同档位复用连接池）。
static CLIENT_CACHE: LazyLock<Mutex<HashMap<String, reqwest::Client>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Deserialize)]
pub struct ProxySetting {
    pub mode: String,
    pub url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpResult {
    pub status: u16,
    pub body: String,
}

/// 桥请求只允许 http/https 目标（socks5 是代理协议，出现在代理地址侧）。
fn validate_http_url(url: &str) -> Result<(), String> {
    if url.starts_with("http://") || url.starts_with("https://") {
        Ok(())
    } else {
        Err("仅支持 http/https 请求".into())
    }
}

fn build_client(proxy: &ProxySetting) -> Result<reqwest::Client, String> {
    let key = format!("{}|{}", proxy.mode, proxy.url.as_deref().unwrap_or(""));
    if let Some(client) = CLIENT_CACHE.lock().unwrap().get(&key) {
        return Ok(client.clone());
    }

    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30));
    match proxy.mode.as_str() {
        "none" => builder = builder.no_proxy(),
        "custom" => {
            let url = proxy.url.as_deref().unwrap_or("").trim();
            let p = reqwest::Proxy::all(url).map_err(|e| format!("代理地址无效: {e}"))?;
            builder = builder.proxy(p);
        }
        // system：读 OS 代理设置（未启用/读取失败 = 直连）
        _ => {
            if let Ok(sp) = sysproxy::Sysproxy::get_system_proxy() {
                if sp.enable {
                    let addr = format!("http://{}:{}", sp.host, sp.port);
                    if let Ok(p) = reqwest::Proxy::all(&addr) {
                        builder = builder.proxy(p);
                    }
                }
            }
        }
    }
    builder
        .build()
        .map_err(|e| format!("HTTP 客户端构建失败: {e}"))
}

/// 桥命令：按代理档位转发同步引擎的 HTTP 请求（JSON 透传，状态码/响应体回传）。
#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    proxy: ProxySetting,
) -> Result<HttpResult, String> {
    validate_http_url(&url)?;
    let client = build_client(&proxy)?;
    let m = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        other => return Err(format!("不支持的 HTTP 方法: {other}")),
    };
    let mut req = client.request(m, &url);
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    if let Some(b) = &body {
        // 同步引擎只发 JSON：显式补 Content-Type（Axum Json<T> 提取器必需）
        req = req
            .header("Content-Type", "application/json")
            .body(b.clone());
    }
    let resp = req.send().await.map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;
    Ok(HttpResult { status, body: text })
}

/// 代理连通性测试：经代理请求探测地址，返回耗时（毫秒）。
#[tauri::command]
pub async fn test_proxy(proxy: ProxySetting, test_url: String) -> Result<u128, String> {
    validate_http_url(&test_url)?;
    let start = std::time::Instant::now();
    let client = build_client(&proxy)?;
    let resp = client
        .get(&test_url)
        .send()
        .await
        .map_err(|e| format!("连接失败: {e}"))?;
    let status = resp.status();
    let _ = resp.text().await;
    if !status.is_success() {
        return Err(format!("探测地址返回 {status}"));
    }
    Ok(start.elapsed().as_millis())
}

/// 读取 OS 系统代理地址（供更新请求跟随系统代理）；未启用返回 null。
#[tauri::command]
pub fn system_proxy_url() -> Option<String> {
    let sp = sysproxy::Sysproxy::get_system_proxy().ok()?;
    if !sp.enable {
        return None;
    }
    Some(format!("http://{}:{}", sp.host, sp.port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds_for_each_mode() {
        let none = ProxySetting {
            mode: "none".into(),
            url: None,
        };
        assert!(build_client(&none).is_ok());

        let system = ProxySetting {
            mode: "system".into(),
            url: None,
        };
        assert!(build_client(&system).is_ok());
    }

    #[test]
    fn invalid_custom_url_fails_client_build() {
        let custom = ProxySetting {
            mode: "custom".into(),
            url: Some("not-a-proxy".into()),
        };
        assert!(build_client(&custom).is_err());
    }

    #[test]
    fn validate_http_url_rejects_non_http_schemes() {
        assert!(validate_http_url("https://example.com").is_ok());
        assert!(validate_http_url("http://example.com/health").is_ok());
        assert!(validate_http_url("ftp://example.com").is_err());
        assert!(validate_http_url("socks5://127.0.0.1:1080").is_err());
    }
}
