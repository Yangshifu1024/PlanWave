//! PlanWave 客户端 WASM 绑定：把 sync-core 的同步引擎 + IndexedDB 存储 + HTTP 传输
//! 组装为可直接在浏览器/WebView 中使用的 `PlanWaveClient`。
//!
//! JS 侧职责只剩：装载本模块、聚焦/网络事件桥、事件转 UI 状态。

pub mod idb_storage;
pub mod transport;

use idb_storage::IdbStorage;
use sync_core::client::Client;
use sync_core::ClientStorage;
use transport::HttpTransport;
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_json::to_string(value)
        .map(|s| JsValue::from_str(&s))
        .map_err(js_err)
}

#[wasm_bindgen]
pub struct PlanWaveClient {
    client: Client<IdbStorage, HttpTransport>,
    transport: HttpTransport,
}

#[wasm_bindgen]
impl PlanWaveClient {
    /// 打开本地 IndexedDB 并组装引擎。`api_base` 形如 `https://host/api`。
    /// （async 关联函数而非 constructor：wasm-bindgen 的 async constructor 已弃用）
    pub async fn new(api_base: String) -> Result<PlanWaveClient, JsValue> {
        console_error_panic_hook::set_once();
        let storage = IdbStorage::open().await.map_err(js_err)?;
        let transport = HttpTransport::new(api_base);
        Ok(Self {
            client: Client::new(storage, transport.clone()),
            transport,
        })
    }

    /// 是否已有账号（决定前端显示登录还是首次初始化）。
    pub async fn status(&self) -> Result<JsValue, JsValue> {
        let has_account = self.transport.status().await.map_err(js_err)?;
        to_js(&serde_json::json!({ "has_account": has_account }))
    }

    pub async fn register(
        &self,
        username: String,
        password: String,
        device_id: String,
        device_name: Option<String>,
    ) -> Result<(), JsValue> {
        self.transport
            .register(&username, &password, &device_id, device_name.as_deref())
            .await
            .map(|_| ())
            .map_err(js_err)
    }

    pub async fn login(
        &self,
        username: String,
        password: String,
        device_id: String,
        device_name: Option<String>,
    ) -> Result<(), JsValue> {
        self.transport
            .login(&username, &password, &device_id, device_name.as_deref())
            .await
            .map(|_| ())
            .map_err(js_err)
    }

    pub fn logout(&self) {
        self.transport.logout();
    }

    /// 启动引擎：确保设备标识、追平远端（新设备走快照引导）。
    pub async fn start(&self) -> Result<(), JsValue> {
        match self.client.start().await {
            Ok(_) => {
                self.mark_sync_ok(None, None).await?;
                Ok(())
            }
            Err(e) => {
                self.mark_sync_err(&e).await;
                Err(js_err(e))
            }
        }
    }

    /// 本地变更唯一入口：`entity_kind` 为 "task" | "project"，`patch_json` 为字段 patch JSON
    /// （不含 `type` 标签，由 entity_kind 决定变体）。
    pub async fn mutate(
        &self,
        entity_kind: String,
        entity_id: String,
        patch_json: String,
    ) -> Result<(), JsValue> {
        let value: serde_json::Value = serde_json::from_str(&patch_json).map_err(js_err)?;
        let patch = match entity_kind.as_str() {
            "project" => sync_core::Patch::Project(serde_json::from_value(value).map_err(js_err)?),
            "task" => sync_core::Patch::Task(serde_json::from_value(value).map_err(js_err)?),
            other => return Err(js_err(format!("未知实体类型: {other}"))),
        };
        self.client.mutate(entity_id, patch).await.map_err(js_err)?;
        Ok(())
    }

    /// 推送本地积压，返回推送条数。
    pub async fn flush(&self) -> Result<u32, JsValue> {
        match self.client.flush().await {
            Ok(n) => {
                self.mark_sync_ok(None, Some(n as u64)).await?;
                Ok(n as u32)
            }
            Err(e) => {
                self.mark_sync_err(&e).await;
                Err(js_err(e))
            }
        }
    }

    /// 刷新 = 推送积压 + 增量拉取（手动刷新/轮询统一入口）。
    pub async fn refresh(&self) -> Result<(), JsValue> {
        match self.client.refresh().await {
            Ok(pulled) => {
                self.mark_sync_ok(Some(pulled as u64), None).await?;
                Ok(())
            }
            Err(e) => {
                self.mark_sync_err(&e).await;
                Err(js_err(e))
            }
        }
    }

    /// 同步详情（同步状态页）：meta + pending 队列 + 最近 op 日志。
    /// `limit` 限制两个列表各返回的条数（总量仍返回 count）。
    pub async fn sync_details(&self, limit: u32) -> Result<JsValue, JsValue> {
        let storage = self.client.storage();
        let meta = storage.meta().await.map_err(js_err)?;
        let mut pending = storage.pending().await.map_err(js_err)?;
        let count = pending.len();
        pending.truncate(limit as usize);
        let recent = storage.recent_ops(limit).await.map_err(js_err)?;
        to_js(&serde_json::json!({
            "meta": meta,
            "pending": { "count": count, "ops": pending },
            "recent_ops": recent,
        }))
    }

    /// 同步成功收尾：更新 last_sync_at/last_error 与 push/pull 观测值。
    async fn mark_sync_ok(&self, pulled: Option<u64>, pushed: Option<u64>) -> Result<(), JsValue> {
        let mut meta = self.client.storage().meta().await.map_err(js_err)?;
        meta.last_sync_at = Some(js_sys::Date::now() as i64);
        meta.last_error = None;
        if let Some(p) = pulled {
            meta.last_pulled = Some(p);
        }
        if let Some(p) = pushed {
            meta.last_pushed = Some(p);
        }
        self.client.storage().set_meta(meta).await.map_err(js_err)
    }

    /// 同步失败收尾：错误文案落到 meta（成功后清空），供详情页展示。
    async fn mark_sync_err(&self, e: &sync_core::ClientError) {
        if let Ok(mut meta) = self.client.storage().meta().await {
            meta.last_error = Some(e.to_string());
            let _ = self.client.storage().set_meta(meta).await;
        }
    }

    pub async fn list_projects(&self) -> Result<JsValue, JsValue> {
        let projects = self
            .client
            .storage()
            .list_projects()
            .await
            .map_err(js_err)?;
        to_js(&projects)
    }

    pub async fn list_tasks(&self) -> Result<JsValue, JsValue> {
        let tasks = self.client.storage().list_tasks().await.map_err(js_err)?;
        to_js(&tasks)
    }

    /// 调试：gloo-storage 往返验证
    pub fn debug_storage_roundtrip(&self) -> Result<String, JsValue> {
        use gloo_storage::Storage;
        gloo_storage::LocalStorage::set("planwave.debug", "roundtrip-ok")
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let v: Result<String, _> = gloo_storage::LocalStorage::get("planwave.debug");
        v.map_err(|e| JsValue::from_str(&e.to_string()))
    }

    pub async fn clear_local(&self) {
        let _ = self.client.storage().reset_local().await;
    }
}
