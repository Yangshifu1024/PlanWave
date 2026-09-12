//! 客户端引擎集成测试：内存假服务端 + 内存存储，移植自前端 engine.test.ts 的场景集。
//! 覆盖：队列推送、双端收敛（含字段独立性）、断网恢复、Lamport 推进、分页、幂等。

use async_trait::async_trait;
use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use sync_core::{
    AppliedOp, Client, ClientError, ClientStorage, Id, Op, Patch, PullPage, PushAck, SequencedOp,
    SyncTransport, TaskPatch,
};
use uuid::Uuid;

// ---- 内存假服务端：与真实服务端相同的定序/幂等语义 ----

#[derive(Debug, Default)]
struct FakeServer {
    seq: u64,
    log: Vec<SequencedOp>,
    seen: HashSet<Id>,
}

impl FakeServer {
    fn push(&mut self, ops: &[Op]) -> PushAck {
        let mut applied = Vec::new();
        for op in ops {
            if let Some(existing) = self.log.iter().find(|s| s.op.op_id == op.op_id) {
                applied.push(AppliedOp {
                    op_id: op.op_id.clone(),
                    seq: existing.seq,
                });
                continue;
            }
            self.seen.insert(op.op_id.clone());
            self.seq += 1;
            let seq = self.seq;
            self.log.push(SequencedOp {
                seq,
                op: op.clone(),
            });
            applied.push(AppliedOp {
                op_id: op.op_id.clone(),
                seq,
            });
        }
        PushAck {
            applied,
            latest_seq: self.seq,
        }
    }

    fn pull(&self, since: u64, limit: u32) -> PullPage {
        let ops: Vec<SequencedOp> = self
            .log
            .iter()
            .filter(|s| s.seq > since)
            .take(limit as usize)
            .cloned()
            .collect();
        let latest_seq = self.seq;
        let has_more = since + (ops.len() as u64) < self.seq;
        PullPage {
            ops,
            latest_seq,
            has_more,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct FakeTransport {
    server: Rc<RefCell<FakeServer>>,
    offline: Rc<Cell<bool>>,
}

#[async_trait(?Send)]
impl SyncTransport for FakeTransport {
    async fn push(&self, _device_id: &str, ops: &[Op]) -> Result<PushAck, ClientError> {
        if self.offline.get() {
            return Err(ClientError::Network("网络中断".into()));
        }
        Ok(self.server.borrow_mut().push(ops))
    }

    async fn pull(&self, since: u64, limit: u32) -> Result<PullPage, ClientError> {
        if self.offline.get() {
            return Err(ClientError::Network("网络中断".into()));
        }
        Ok(self.server.borrow().pull(since, limit))
    }
}

// ---- 内存客户端存储 ----

#[derive(Debug, Default)]
struct MemInner {
    meta: sync_core::SyncMeta,
    projects: HashMap<Id, sync_core::ProjectRecord>,
    tasks: HashMap<Id, sync_core::TaskRecord>,
    seen: HashSet<Id>,
    queue: Vec<Op>,
}

#[derive(Debug, Default)]
struct MemStorage {
    inner: RefCell<MemInner>,
}

impl MemStorage {
    fn tasks(&self) -> HashMap<Id, sync_core::TaskRecord> {
        self.inner.borrow().tasks.clone()
    }
}

#[async_trait(?Send)]
impl ClientStorage for MemStorage {
    async fn meta(&self) -> Result<sync_core::SyncMeta, ClientError> {
        Ok(self.inner.borrow().meta.clone())
    }

    async fn set_meta(&self, meta: sync_core::SyncMeta) -> Result<(), ClientError> {
        self.inner.borrow_mut().meta = meta;
        Ok(())
    }

    async fn apply_remote(&self, ops: &[SequencedOp]) -> Result<u32, ClientError> {
        let mut inner = self.inner.borrow_mut();
        let mut applied = 0u32;
        for s in ops {
            if inner.seen.contains(&s.op.op_id) {
                continue;
            }
            match &s.op.patch {
                sync_core::Patch::Task(p) => {
                    let rec = inner
                        .tasks
                        .entry(s.op.entity_id.clone())
                        .or_insert_with(|| sync_core::task_defaults(&s.op.entity_id));
                    sync_core::apply_task_record(rec, p);
                }
                sync_core::Patch::Project(p) => {
                    let rec = inner
                        .projects
                        .entry(s.op.entity_id.clone())
                        .or_insert_with(|| sync_core::project_defaults(&s.op.entity_id));
                    sync_core::apply_project_record(rec, p);
                }
            }
            inner.seen.insert(s.op.op_id.clone());
            applied += 1;
            if s.seq > inner.meta.last_pulled_seq {
                inner.meta.last_pulled_seq = s.seq;
            }
            if s.op.lamport > inner.meta.lamport {
                inner.meta.lamport = s.op.lamport;
            }
        }
        Ok(applied)
    }

    async fn apply_local(&self, op: &Op) -> Result<(), ClientError> {
        let mut inner = self.inner.borrow_mut();
        match &op.patch {
            sync_core::Patch::Task(p) => {
                let rec = inner
                    .tasks
                    .entry(op.entity_id.clone())
                    .or_insert_with(|| sync_core::task_defaults(&op.entity_id));
                sync_core::apply_task_record(rec, p);
            }
            sync_core::Patch::Project(p) => {
                let rec = inner
                    .projects
                    .entry(op.entity_id.clone())
                    .or_insert_with(|| sync_core::project_defaults(&op.entity_id));
                sync_core::apply_project_record(rec, p);
            }
        }
        inner.seen.insert(op.op_id.clone());
        if op.lamport > inner.meta.lamport {
            inner.meta.lamport = op.lamport;
        }
        inner.queue.push(op.clone());
        Ok(())
    }

    async fn pending(&self) -> Result<Vec<Op>, ClientError> {
        Ok(self.inner.borrow().queue.clone())
    }

    async fn dequeue(&self, op_ids: &[Id]) -> Result<(), ClientError> {
        let ids: HashSet<&Id> = op_ids.iter().collect();
        self.inner
            .borrow_mut()
            .queue
            .retain(|op| !ids.contains(&op.op_id));
        Ok(())
    }
}

type Rig = (
    Rc<RefCell<FakeServer>>,
    Rc<Cell<bool>>,
    Client<MemStorage, FakeTransport>,
    Client<MemStorage, FakeTransport>,
);

fn rig() -> Rig {
    let server = Rc::new(RefCell::new(FakeServer::default()));
    let offline = Rc::new(Cell::new(false));
    let transport_a = FakeTransport {
        server: server.clone(),
        offline: offline.clone(),
    };
    let transport_b = FakeTransport {
        server: server.clone(),
        offline: offline.clone(),
    };
    (
        server,
        offline,
        Client::new(MemStorage::default(), transport_a),
        Client::new(MemStorage::default(), transport_b),
    )
}

fn title(t: &str) -> Patch {
    Patch::Task(TaskPatch {
        title: Some(t.into()),
        ..Default::default()
    })
}

#[tokio::test]
async fn local_write_visible_immediately_and_flush_drains_queue() {
    let (_server, _offline, a, _b) = rig();
    let id = Uuid::new_v4().to_string();

    let op = a.mutate(id.clone(), title("买牛奶")).await.unwrap();
    assert_eq!(op.lamport, 1);
    // 立即可见（本地优先）
    let tasks = a.storage().tasks();
    assert_eq!(tasks.get(&id).map(|t| t.title.as_str()), Some("买牛奶"));
    assert_eq!(a.storage().pending().await.unwrap().len(), 1);

    a.flush().await.unwrap();
    assert!(a.storage().pending().await.unwrap().is_empty());
}

#[tokio::test]
async fn two_devices_converge_with_field_level_merge() {
    let (_server, _offline, a, b) = rig();
    let id = Uuid::new_v4().to_string();

    a.mutate(id.clone(), title("初稿")).await.unwrap();
    a.flush().await.unwrap();

    b.pull_all().await.unwrap();
    let b_title = b.storage().tasks()[&id].title.clone();
    assert_eq!(b_title, "初稿");

    // B 改标题（seq 更大 → 胜出）
    b.mutate(id.clone(), title("B 的版本")).await.unwrap();
    b.flush().await.unwrap();

    a.pull_all().await.unwrap();
    assert_eq!(a.storage().tasks()[&id].title, "B 的版本");

    // 不同字段互不覆盖：A 改优先级，B 的标题保留
    a.mutate(
        id.clone(),
        Patch::Task(TaskPatch {
            priority: Some(3),
            ..Default::default()
        }),
    )
    .await
    .unwrap();
    a.flush().await.unwrap();
    b.pull_all().await.unwrap();
    let t = &b.storage().tasks()[&id];
    assert_eq!(t.title, "B 的版本");
    assert_eq!(t.priority, 3);
}

#[tokio::test]
async fn offline_writes_queue_and_sync_after_recovery() {
    let (_server, offline, a, _b) = rig();
    offline.set(true);

    let id1 = Uuid::new_v4().to_string();
    let id2 = Uuid::new_v4().to_string();
    a.mutate(id1.clone(), title("离线写 1")).await.unwrap();
    a.mutate(id2.clone(), title("离线写 2")).await.unwrap();

    // flush 失败，队列保留
    assert!(a.flush().await.is_err());
    assert_eq!(a.storage().pending().await.unwrap().len(), 2);

    offline.set(false);
    a.flush().await.unwrap();
    assert!(a.storage().pending().await.unwrap().is_empty());
}

#[tokio::test]
async fn lamport_clock_advances_both_ways() {
    let (_server, _offline, a, b) = rig();

    a.mutate(Uuid::new_v4().to_string(), title("a1"))
        .await
        .unwrap();
    a.mutate(Uuid::new_v4().to_string(), title("a2"))
        .await
        .unwrap();
    assert_eq!(a.storage().meta().await.unwrap().lamport, 2);
    a.flush().await.unwrap();

    b.pull_all().await.unwrap();
    assert_eq!(b.storage().meta().await.unwrap().lamport, 2);

    b.mutate(Uuid::new_v4().to_string(), title("b1"))
        .await
        .unwrap();
    assert_eq!(b.storage().meta().await.unwrap().lamport, 3);
    b.flush().await.unwrap();

    a.pull_all().await.unwrap();
    assert_eq!(a.storage().meta().await.unwrap().lamport, 3);
}

#[tokio::test]
async fn pull_paginates_until_caught_up() {
    let (server, _offline, a, _b) = rig();
    // 塞入 1500 条 op（页大小 1000 → 至少两页）
    for i in 0..1500u32 {
        let op = Op::new(
            "bulk",
            i as u64 + 1,
            Uuid::new_v4().to_string(),
            Patch::Task(TaskPatch {
                title: Some(format!("任务 {i}")),
                ..Default::default()
            }),
        );
        server.borrow_mut().push(&[op]);
    }
    a.pull_all().await.unwrap();
    assert_eq!(a.storage().tasks().len(), 1500);
    assert_eq!(a.storage().meta().await.unwrap().last_pulled_seq, 1500);
}

#[tokio::test]
async fn repeated_pull_is_idempotent() {
    let (_server, _offline, a, _b) = rig();
    a.mutate(Uuid::new_v4().to_string(), title("只算一次"))
        .await
        .unwrap();
    a.flush().await.unwrap();
    a.pull_all().await.unwrap();
    let count1 = a.storage().tasks().len();
    a.pull_all().await.unwrap();
    assert_eq!(a.storage().tasks().len(), count1);
}
