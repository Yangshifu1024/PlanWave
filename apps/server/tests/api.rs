//! 端到端 API 集成测试：起真实 HTTP 服务器（内存存储），reqwest 全流程走通。
//! MySQL 路径的存储级测试见 tests/mysql_store.rs（需 DATABASE_URL）。

use planwave_server::{api::build_router, store::MemoryStore, AppState};
use serde_json::{json, Value};
use std::sync::Arc;

async fn spawn_app() -> String {
    let state = AppState::new(Arc::new(MemoryStore::new()), "test-secret", 15, 30);
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}")
}

struct App {
    base: String,
    http: reqwest::Client,
}

impl App {
    async fn new() -> Self {
        Self {
            base: spawn_app().await,
            http: reqwest::Client::new(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    /// 注册单账号并返回 access token（每台测试设备用独立 id）。
    async fn register_and_login(&self, device: &str) -> String {
        let res = self
            .http
            .post(self.url("/auth/register"))
            .json(&json!({
                "username": "planwave",
                "password": "super-secret-8",
                "device_id": device,
                "device_name": "测试设备"
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(
            res.status(),
            200,
            "注册应成功: {}",
            res.text().await.unwrap()
        );
        let body: Value = res.json().await.unwrap();
        body["access_token"].as_str().unwrap().to_string()
    }
}

fn task_op(device: &str, op_id: &str, entity_id: &str, patch: Value) -> Value {
    json!({
        "op_id": op_id,
        "device_id": device,
        "lamport": 1,
        "entity_id": entity_id,
        "patch": patch,
        "client_time_ms": 1_700_000_000_000i64
    })
}

#[tokio::test]
async fn health_ok() {
    let app = App::new().await;
    let res = app.http.get(app.url("/health")).send().await.unwrap();
    assert_eq!(res.status(), 200);
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn auth_status_and_single_account() {
    let app = App::new().await;

    let res = app.http.get(app.url("/auth/status")).send().await.unwrap();
    assert_eq!(
        res.json::<Value>().await.unwrap()["has_account"],
        json!(false)
    );

    let token = app.register_and_login("device-1").await;
    assert!(!token.is_empty());

    let res = app.http.get(app.url("/auth/status")).send().await.unwrap();
    assert_eq!(
        res.json::<Value>().await.unwrap()["has_account"],
        json!(true)
    );

    // 第二次注册必须 409（单用户设计）
    let res = app
        .http
        .post(app.url("/auth/register"))
        .json(&json!({
            "username": "other",
            "password": "another-pass-8",
            "device_id": "device-2"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 409);
}

#[tokio::test]
async fn auth_requires_min_password_and_rejects_bad_login() {
    let app = App::new().await;

    let res = app
        .http
        .post(app.url("/auth/register"))
        .json(&json!({ "username": "u", "password": "短", "device_id": "d" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 422);

    app.register_and_login("device-1").await;

    let res = app
        .http
        .post(app.url("/auth/login"))
        .json(&json!({ "username": "planwave", "password": "wrong-password", "device_id": "device-1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);

    let res = app
        .http
        .post(app.url("/auth/login"))
        .json(&json!({ "username": "planwave", "password": "super-secret-8", "device_id": "device-1" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
}

#[tokio::test]
async fn refresh_rotates_tokens() {
    let app = App::new().await;
    let register_res = app
        .http
        .post(app.url("/auth/register"))
        .json(&json!({ "username": "planwave", "password": "super-secret-8", "device_id": "device-1" }))
        .send()
        .await
        .unwrap();
    let pair: Value = register_res.json().await.unwrap();

    let res = app
        .http
        .post(app.url("/auth/refresh"))
        .json(&json!({ "refresh_token": pair["refresh_token"] }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let new_pair: Value = res.json().await.unwrap();
    assert!(!new_pair["access_token"].as_str().unwrap().is_empty());

    // access token 不能当 refresh 用
    let res = app
        .http
        .post(app.url("/auth/refresh"))
        .json(&json!({ "refresh_token": pair["access_token"] }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn sync_requires_auth() {
    let app = App::new().await;
    let res = app
        .http
        .post(app.url("/sync/push"))
        .json(&json!({ "device_id": "d", "ops": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);

    let res = app
        .http
        .get(app.url("/sync/pull?since=0"))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
}

#[tokio::test]
async fn push_assigns_global_seq_and_pull_returns_in_order() {
    let app = App::new().await;
    let token = app.register_and_login("device-1").await;

    let entity = uuid::Uuid::new_v4().to_string();
    let ops = vec![
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &entity,
            json!({"type":"task","title":"任务一"}),
        ),
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &entity,
            json!({"type":"task","completed":true}),
        ),
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &entity,
            json!({"type":"task","title":"任务一改"}),
        ),
    ];
    let res = app
        .http
        .post(app.url("/sync/push"))
        .bearer_auth(&token)
        .json(&json!({ "device_id": "device-1", "ops": ops }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "{}", res.text().await.unwrap());
    let body: Value = res.json().await.unwrap();
    let seqs: Vec<u64> = body["applied"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["seq"].as_u64().unwrap())
        .collect();
    assert_eq!(seqs, vec![1, 2, 3]);
    assert_eq!(body["latest_seq"], json!(3));

    // 全量拉取：3 条，顺序与 seq 一致
    let res = app
        .http
        .get(app.url("/sync/pull?since=0"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["latest_seq"], json!(3));
    assert_eq!(body["has_more"], json!(false));
    let pulled = body["ops"].as_array().unwrap();
    assert_eq!(pulled.len(), 3);
    assert_eq!(pulled[0]["seq"], json!(1));
    assert_eq!(pulled[2]["seq"], json!(3));
    // LWW：最后一条 title op 胜出
    assert_eq!(pulled[2]["patch"]["title"], json!("任务一改"));

    // 增量拉取：since=2 只剩 1 条
    let res = app
        .http
        .get(app.url("/sync/pull?since=2"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["ops"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn push_duplicate_ops_is_idempotent() {
    let app = App::new().await;
    let token = app.register_and_login("device-1").await;

    let op_id = uuid::Uuid::new_v4().to_string();
    let entity = uuid::Uuid::new_v4().to_string();
    let op = task_op(
        "device-1",
        &op_id,
        &entity,
        json!({"type":"task","title":"只算一次"}),
    );

    for expected_seq in [1u64, 1u64] {
        let res = app
            .http
            .post(app.url("/sync/push"))
            .bearer_auth(&token)
            .json(&json!({ "device_id": "device-1", "ops": [op] }))
            .send()
            .await
            .unwrap();
        let body: Value = res.json().await.unwrap();
        assert_eq!(body["applied"][0]["seq"], json!(expected_seq));
        assert_eq!(body["applied"][0]["op_id"], json!(op_id));
    }

    let res = app
        .http
        .get(app.url("/sync/pull?since=0"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["ops"].as_array().unwrap().len(), 1, "重复投递只落一条");
}

#[tokio::test]
async fn push_rejects_invalid_ops_atomically() {
    let app = App::new().await;
    let token = app.register_and_login("device-1").await;

    let ops = vec![
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &uuid::Uuid::new_v4().to_string(),
            json!({"type":"task","title":"合法"}),
        ),
        // 空 patch：非法
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &uuid::Uuid::new_v4().to_string(),
            json!({"type":"task"}),
        ),
    ];
    let res = app
        .http
        .post(app.url("/sync/push"))
        .bearer_auth(&token)
        .json(&json!({ "device_id": "device-1", "ops": ops }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 422);

    // 整批未提交：全量拉取应为空
    let res = app
        .http
        .get(app.url("/sync/pull?since=0"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["ops"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn push_accepts_subtask_and_recurrence_fields() {
    let app = App::new().await;
    let token = app.register_and_login("device-1").await;

    let parent = uuid::Uuid::new_v4().to_string();
    let child = uuid::Uuid::new_v4().to_string();
    let ops = vec![
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &parent,
            json!({"type":"task","title":"父任务","recurrence":{"freq":"weekly","interval":2,"weekdays":[1,3,5]}}),
        ),
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &child,
            json!({"type":"task","title":"子任务","parent_id":parent}),
        ),
        // 清空重复规则：recurrence=null
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &parent,
            json!({"type":"task","recurrence":null}),
        ),
    ];
    let res = app
        .http
        .post(app.url("/sync/push"))
        .bearer_auth(&token)
        .json(&json!({ "device_id": "device-1", "ops": ops }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "{}", res.text().await.unwrap());

    let res = app
        .http
        .get(app.url("/sync/snapshot"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200, "{}", res.text().await.unwrap());
    let body: Value = res.json().await.unwrap();
    assert_eq!(body["seq"], json!(3));
    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 2);

    let parent_row = tasks.iter().find(|t| t["id"] == json!(parent)).unwrap();
    // LWW：最后一条 recurrence 清空胜出
    assert_eq!(parent_row["recurrence"], Value::Null);
    let child_row = tasks.iter().find(|t| t["id"] == json!(child)).unwrap();
    assert_eq!(child_row["parent_id"], json!(parent));
    assert_eq!(child_row["title"], json!("子任务"));
}

#[tokio::test]
async fn snapshot_reflects_projection_with_tombstones_and_auth() {
    let app = App::new().await;

    // 未鉴权拒绝
    let res = app.http.get(app.url("/sync/snapshot")).send().await.unwrap();
    assert_eq!(res.status(), 401);

    let token = app.register_and_login("device-1").await;
    let project = uuid::Uuid::new_v4().to_string();
    let task = uuid::Uuid::new_v4().to_string();
    let ops = vec![
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &project,
            json!({"type":"project","name":"工作"}),
        ),
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &task,
            json!({"type":"task","title":"被删任务"}),
        ),
        task_op(
            "device-1",
            uuid::Uuid::new_v4().to_string().as_str(),
            &task,
            json!({"type":"task","deleted":true}),
        ),
    ];
    let res = app
        .http
        .post(app.url("/sync/push"))
        .bearer_auth(&token)
        .json(&json!({ "device_id": "device-1", "ops": ops }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = app
        .http
        .get(app.url("/sync/snapshot"))
        .bearer_auth(&token)
        .send()
        .await
        .unwrap();
    let body: Value = res.json().await.unwrap();
    // 快照含墓碑记录（与回放语义一致，客户端不会「复活」已删实体）
    assert_eq!(body["seq"], json!(3));
    assert_eq!(body["projects"].as_array().unwrap().len(), 1);
    assert_eq!(body["projects"][0]["name"], json!("工作"));
    let tasks = body["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["deleted"], json!(true));
}
