//! JSON 互操作契约测试：Rust 侧序列化形状必须与前端 TypeScript 侧一致。
//! 这些用例里的 JSON 字面量是两端的「接口冻结」凭证。

use serde_json::{json, Value};
use sync_core::{
    Op, Patch, ProjectPatch, RecurrenceFreq, RecurrenceRule, SequencedOp, Set, SyncMeta, TaskPatch,
};

#[test]
fn task_patch_serializes_with_expected_shape() {
    let patch = Patch::Task(TaskPatch {
        title: Some("写周报".into()),
        completed: Some(true),
        due_date: Some(Set::Value(1_700_000_000_000)),
        ..Default::default()
    });
    let v = serde_json::to_value(&patch).unwrap();
    assert_eq!(
        v,
        json!({
            "type": "task",
            "title": "写周报",
            "completed": true,
            "due_date": 1_700_000_000_000i64
        })
    );
}

#[test]
fn due_date_clear_serializes_as_null_and_absent_is_untouched() {
    let clear = Patch::Task(TaskPatch {
        due_date: Some(Set::Clear),
        ..Default::default()
    });
    let v = serde_json::to_value(&clear).unwrap();
    assert_eq!(v, json!({ "type": "task", "due_date": null }));

    let untouched = Patch::Task(TaskPatch {
        title: Some("x".into()),
        ..Default::default()
    });
    let v = serde_json::to_value(&untouched).unwrap();
    assert_eq!(v, json!({ "type": "task", "title": "x" }));
}

#[test]
fn project_patch_roundtrip() {
    let patch = Patch::Project(ProjectPatch {
        name: Some("工作".into()),
        color: Some("blue".into()),
        sort_order: Some(1.5),
        ..Default::default()
    });
    let v = serde_json::to_value(&patch).unwrap();
    assert_eq!(v["type"], json!("project"));
    let de: Patch = serde_json::from_value(v).unwrap();
    assert_eq!(de, patch);
}

#[test]
fn op_and_sequenced_op_roundtrip_with_flattened_seq() {
    let op = Op {
        op_id: "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c4d5e".into(),
        device_id: "device-a".into(),
        lamport: 7,
        entity_id: "e2a4b98f-5e64-4a5e-b3c3-9c19a8778a11".into(),
        patch: Patch::Task(TaskPatch {
            title: Some("hi".into()),
            labels: Some(vec!["重要".into(), "今日".into()]),
            ..Default::default()
        }),
        client_time_ms: 1_700_000_000_000,
    };
    let seq_op = SequencedOp { seq: 42, op };
    let v = serde_json::to_value(&seq_op).unwrap();
    // seq 与 op 字段拍平在同一层 —— 前端按此形状读取
    assert_eq!(v["seq"], json!(42));
    assert_eq!(v["op_id"], json!("0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c4d5e"));
    assert_eq!(v["device_id"], json!("device-a"));
    assert_eq!(v["lamport"], json!(7));
    assert_eq!(v["patch"]["labels"], json!(["重要", "今日"]));

    let de: SequencedOp = serde_json::from_value(v).unwrap();
    assert_eq!(de, seq_op);
}

#[test]
fn deserialize_from_frontend_style_json() {
    // 前端手工构造的 JSON（TS 对象字面量）必须能被 Rust 侧读取
    let raw: Value = json!({
        "seq": 1,
        "op_id": "0d9d4a2f-2f2a-4b0e-9d8e-1f0a2b3c4d5e",
        "device_id": "web-1",
        "lamport": 3,
        "entity_id": "e2a4b98f-5e64-4a5e-b3c3-9c19a8778a11",
        "patch": { "type": "task", "title": "来自前端的任务", "priority": 2 },
        "client_time_ms": 1_700_000_000_000i64
    });
    let de: SequencedOp = serde_json::from_value(raw).unwrap();
    de.op.validate().unwrap();
    match &de.op.patch {
        Patch::Task(p) => assert_eq!(p.title.as_deref(), Some("来自前端的任务")),
        _ => panic!("expected task patch"),
    }
}

#[test]
fn recurrence_and_parent_id_serialize_with_expected_shape() {
    let rule = RecurrenceRule {
        freq: RecurrenceFreq::Weekly,
        interval: 2,
        weekdays: vec![1, 3, 5],
    };
    let set = Patch::Task(TaskPatch {
        recurrence: Some(Set::Value(rule.clone())),
        parent_id: Some(Set::Value("e2a4b98f-5e64-4a5e-b3c3-9c19a8778a11".into())),
        ..Default::default()
    });
    let v = serde_json::to_value(&set).unwrap();
    assert_eq!(
        v,
        json!({
            "type": "task",
            "recurrence": { "freq": "weekly", "interval": 2, "weekdays": [1, 3, 5] },
            "parent_id": "e2a4b98f-5e64-4a5e-b3c3-9c19a8778a11"
        })
    );
    let de: Patch = serde_json::from_value(v).unwrap();
    assert_eq!(de, set);

    // 清空：两个字段均以 null 出现
    let clear = Patch::Task(TaskPatch {
        recurrence: Some(Set::Clear),
        parent_id: Some(Set::Clear),
        ..Default::default()
    });
    let v = serde_json::to_value(&clear).unwrap();
    assert_eq!(v, json!({ "type": "task", "recurrence": null, "parent_id": null }));

    // 反序列化方向同样成立：显式 null = 清空（不是「不动」）
    let de: Patch = serde_json::from_value(json!({ "type": "task", "recurrence": null })).unwrap();
    assert_eq!(
        de,
        Patch::Task(TaskPatch {
            recurrence: Some(Set::Clear),
            ..Default::default()
        })
    );
    // due_date 的 null 同理（清空截止日期）
    let de: Patch = serde_json::from_value(json!({ "type": "task", "due_date": null })).unwrap();
    assert_eq!(
        de,
        Patch::Task(TaskPatch {
            due_date: Some(Set::Clear),
            ..Default::default()
        })
    );

    // 缺省 = 不动（不出现这两个键）
    let untouched = Patch::Task(TaskPatch {
        title: Some("x".into()),
        ..Default::default()
    });
    let v = serde_json::to_value(&untouched).unwrap();
    assert!(v.get("recurrence").is_none());
    assert!(v.get("parent_id").is_none());
}

#[test]
fn recurrence_empty_weekdays_omitted_and_defaults_apply() {
    let rule = RecurrenceRule {
        freq: RecurrenceFreq::Daily,
        interval: 1,
        weekdays: vec![],
    };
    let v = serde_json::to_value(&rule).unwrap();
    assert_eq!(v, json!({ "freq": "daily", "interval": 1 }));
    // interval 缺省 = 1，weekdays 缺省 = 空
    let de: RecurrenceRule = serde_json::from_value(json!({ "freq": "monthly" })).unwrap();
    assert_eq!(
        de,
        RecurrenceRule {
            freq: RecurrenceFreq::Monthly,
            interval: 1,
            weekdays: vec![]
        }
    );
}

#[test]
fn sync_meta_new_fields_are_backward_compatible() {
    // 旧版本持久化的 meta JSON（只有三个键）必须能被读取
    let old = json!({
        "device_id": "device-a",
        "lamport": 9,
        "last_pulled_seq": 42
    });
    let de: SyncMeta = serde_json::from_value(old).unwrap();
    assert_eq!(de.last_sync_at, None);
    assert_eq!(de.last_error, None);
    assert_eq!(de.last_pushed, None);
    assert_eq!(de.last_pulled, None);

    let meta = SyncMeta {
        device_id: "d".into(),
        lamport: 1,
        last_pulled_seq: 2,
        last_sync_at: Some(1_700_000_000_000),
        last_error: Some("HTTP 500".into()),
        last_pushed: Some(3),
        last_pulled: Some(5),
    };
    let v = serde_json::to_value(&meta).unwrap();
    assert_eq!(v["last_sync_at"], json!(1_700_000_000_000i64));
    assert_eq!(v["last_error"], json!("HTTP 500"));
    assert_eq!(v["last_pushed"], json!(3));
    assert_eq!(v["last_pulled"], json!(5));
}
