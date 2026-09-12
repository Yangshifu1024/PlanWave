//! MySQL 存储级测试：设置 DATABASE_URL 时真连 MySQL 跑（CI 里由 service 容器提供）；
//! 本地未设置时自动跳过（打印提示），`cargo test` 不会因此失败。
//!
//! 测试不假设数据库为空（可反复运行）：全部使用随机实体/op id，只断言相对关系。

use planwave_server::store::Store;
use sync_core::{Op, Patch, SequencedOp, TaskPatch};
use uuid::Uuid;

fn skip_if_no_db() -> Option<String> {
    match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => Some(url),
        _ => {
            eprintln!("跳过 MySQL 存储测试：未设置 DATABASE_URL");
            None
        }
    }
}

fn task_title_op(entity: &str, title: &str) -> Op {
    Op {
        op_id: Uuid::new_v4().to_string(),
        device_id: "test-device".into(),
        lamport: 1,
        entity_id: entity.to_string(),
        patch: Patch::Task(TaskPatch {
            title: Some(title.into()),
            ..Default::default()
        }),
        client_time_ms: 1_700_000_000_000,
    }
}

#[tokio::test]
async fn mysql_push_pull_idempotent_and_projection() {
    let Some(url) = skip_if_no_db() else { return };
    let store = planwave_server::store::mysql::MySqlStore::connect(&url)
        .await
        .expect("连接 MySQL 失败");

    let entity = Uuid::new_v4().to_string();
    let op1 = task_title_op(&entity, "MySQL 里的第一个任务");
    let op2 = task_title_op(&entity, "MySQL 里的第二个任务");

    // push 两批
    let seqs1 = store.push(std::slice::from_ref(&op1)).await.unwrap();
    let seqs2 = store.push(std::slice::from_ref(&op2)).await.unwrap();
    assert_eq!(seqs1.len(), 1);
    assert_eq!(seqs2.len(), 1);
    assert!(seqs2[0] > seqs1[0], "seq 必须单调递增");

    // 重复 push 幂等：返回同一 seq
    let again = store.push(std::slice::from_ref(&op1)).await.unwrap();
    assert_eq!(again, seqs1);

    // pull 增量：since = seqs1[0] 应只含 seq 更大的 op（可含其他测试写入的数据）
    let (ops_since, latest) = store.pull(seqs1[0], 1000).await.unwrap();
    assert!(ops_since.iter().all(|s: &SequencedOp| s.seq > seqs1[0]));
    assert!(ops_since.iter().any(|s| s.op.op_id == op2.op_id));
    assert!(latest >= seqs2[0]);

    // pull 结果按 seq 严格升序
    for w in ops_since.windows(2) {
        assert!(w[1].seq > w[0].seq, "pull 结果必须按 seq 升序");
    }

    // 权威投影：tasks 表中的行应等于按全序应用 patch 的 LWW 结果
    let pool = sqlx::mysql::MySqlPool::connect(&url).await.unwrap();
    let (title, due_date, deleted): (String, Option<i64>, bool) =
        sqlx::query_as("SELECT title, due_date, deleted FROM tasks WHERE id = ?")
            .bind(&entity)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(title, "MySQL 里的第二个任务", "投影应反映 LWW 结果");
    assert_eq!(due_date, None);
    assert!(!deleted);
    pool.close().await;
}
