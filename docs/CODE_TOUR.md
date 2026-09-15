# PlanWave 源码导览（CODE TOUR）

> 配合 [README](../README.md) 的「同步协议」一节阅读。本文回答三个问题：
> 每个目录是干什么的？一次任务修改是怎么流经整个系统的？想改需求该去哪里改？

## 一、先建立心智模型：三块拼图

```
┌─ 客户端世界（一套产物，六端通用） ─┐   ┌─ 后端世界（Rust） ────────────┐
│                                    │   │                              │
│  apps/web        UI（React+HeroUI）│   │  apps/server     API + MySQL │
│  crates/sync-wasm  数据层绑定       │   │  crates/sync-core 同步语义    │
│  （HTTP/IndexedDB/token，Rust→WASM）│   │  （op 如何合并，纯逻辑）      │
│  crates/sync-core  同步语义+引擎    │   │                              │
└──────────────┬─────────────────────┘   └──────────────┬───────────────┘
               │     apps/client：Tauri 2 壳             │
               │     （窗口 + 通知，无存储逻辑）          │
               └──────────── HTTP push/pull ─────────────┘
```

核心思想一句话：**每个端本地都有完整数据库（IndexedDB），改动先写本地（UI 零延迟），再以「操作日志 op」的形式与其他端交换；服务端不裁决内容，只负责给 op 按到达顺序发号（seq），所有端按同一顺序重放，结果必然一致。**

v2 的关键决定：**客户端数据层只有一种实现**——同步语义、同步引擎、HTTP、存储全部是 Rust，经 wasm-bindgen 编译成 WASM，浏览器 / 桌面 WebView / Android WebView / iOS WebView 跑的是同一个 `planwave_bg.wasm`。不存在「桌面 SQLite、浏览器 IndexedDB」两套存储，也就没有两套语义要同步维护。

因此代码分为三类：
1. **同步语义**（op 长什么样、怎么合并、引擎状态机）——只在 Rust 里写一份（`sync-core`），服务端重放与客户端引擎直接共享；
2. **同步的落地**（HTTP 收发、IndexedDB 读写、token 管理）——只在 `sync-wasm` 写一份，六端共用；
3. **业务与界面**（任务、清单、UI 组件）——最薄的一层（`apps/web`），只调 WASM 客户端。

## 二、逐目录说明

### `crates/sync-core/` —— 同步内核 ★ 项目的灵魂，先读这里

纯 Rust、零 IO、零数据库依赖，所有同步语义都可纯函数验证。

| 文件 | 职责 |
|---|---|
| `src/model.rs` | **Op / Patch 数据结构**。一条 op = 「哪个实体（entity_id）+ 改了哪些字段（patch）+ 谁改的（device_id/lamport）+ 唯一编号（op_id）」。patch 是字段级的：缺省=不动，`null`=清空，有值=覆盖 |
| `src/merge.rs` | **合并规则**：把 patch 应用到记录。三条铁律——缺席字段不动；实体不存在视为创建（默认值落底）；对墓碑（已删除）的其他字段编辑不会复活它。另有 forget op（`Patch::TaskForget`，回收站彻底删除）：从投影移除记录本身，按 seq 全序与快照收敛一致 |
| `src/replay.rs` | **重放引擎**：按服务端 seq 顺序重放 op 集合，`op_id` 去重保证幂等。这是「所有端必然收敛」的正确性模型 |
| `src/clock.rs` | Lamport 逻辑时钟：客户端本地 op 的时钟只增不减 |
| `src/client.rs` | **客户端同步状态机**（纯逻辑，存储与传输是 trait）：`mutate()` 本地立即生效+入队、`flush()` 分批推送+幂等出队、`pull_all()` 分页追平（单飞+尾随合并）、`refresh()` = flush+pull、`start()` 新设备快照引导（失败回退全量回放） |
| `tests/` | 随机化收敛性测试（任意全序 → 同一状态）、与服务端 JSON 的契约测试、客户端状态机 9 场景（双端收敛/断网恢复/幂等/Lamport 推进/分页/快照引导/回退/离线写保留） |

### `crates/sync-wasm/` —— 唯一的数据层实现（Rust→WASM）

| 文件 | 职责 |
|---|---|
| `src/lib.rs` | `PlanWaveClient`（wasm-bindgen 入口）：new/mutate/refresh/flush/start/sync_details/list_*/register/login/logout；JSON 字符串过 JS/Rust 边界；refresh/flush/start 的结果落到 SyncMeta（最近同步时间/错误/push/pull 条数） |
| `src/idb_storage.rs` | `ClientStorage` trait 的 IndexedDB 实现（idb crate）：projects/tasks/seen_ops 去重/pending_ops 自增队列/meta/recent_ops 最近 op 环形日志（100 条，同步详情页数据源）。拉取按**每页一个事务**批量应用；`reset_with_snapshot` 快照引导后重放 pending，本地未同步编辑不丢 |
| `src/transport.rs` | `SyncTransport` trait 的 HTTP 实现（gloo-net）：push/pull/snapshot + 注册/登录/刷新，token 存 localStorage，401 自动刷新后重试 |

### `apps/server/` —— Axum 后端

| 文件 | 职责 |
|---|---|
| `src/api/mod.rs` | 路由表：`/auth/*`、`/sync/push|pull|snapshot`、`/health`；gzip 压缩层（pull/snapshot 响应） |
| `src/api/sync_api.rs` | 同步端点：push（批量原子、校验、定序）、pull（按 seq 增量分页）、snapshot（权威投影+seq，新设备引导）。无推送通道——客户端拉取制 |
| `src/api/auth_api.rs` | 单账号注册/登录/刷新（首个注册的账号即永久账号） |
| `src/auth.rs` | JWT 签发/校验（access 15min + refresh 轮换）+ argon2id 密码 |
| `src/store/mod.rs` | **存储层接口（trait）**：`push/pull/snapshot/账号/设备` |
| `src/store/memory.rs` | 内存实现：本地开发、集成测试、E2E 全靠它（无数据库也能跑通全流程） |
| `src/store/mysql.rs` | MySQL 实现：单事务内「写 oplog + 更新权威投影表」，语义与 sync-core 逐字段一致 |
| `migrations/` | `0001_init.sql` 建表：`ops`（oplog，seq 自增主键）、`projects/tasks`（投影）、`account/devices`；`0002_subtask_recurrence.sql` 加 `parent_id`/`recurrence` 列 |

### `apps/web/` —— 界面（React，六端同一份构建产物）

| 文件 | 职责 |
|---|---|
| `src/wasm/client.ts` | WASM 装载器 + 类型化包装（JSON 字符串 ↔ 对象）；调试句柄 `__planwave` |
| `src/state/store.ts` | Zustand 全局状态 + 所有领域动作（addTask/toggleTask…），全部转调 WASM 客户端 `mutate`；**1.5s 防抖自动推送**、60s 前台轮询、聚焦/online 事件桥、reload 世代号（防并发旧读覆盖新写） |
| `src/components/` | AuthScreen（登录）、Sidebar（侧栏）、TaskList（列表+搜索+刷新按钮+同步徽章+下拉刷新+列表/月切换）、MonthView（月网格+拖拽改期+未排期抽屉）、DayTasksOverlay（某天任务浮层）、TaskRow（单行，子任务缩进/进度/折叠）、TaskDetail（详情面板+子任务管理+重复规则编辑器）、SyncStatusSheet（同步状态详情页：pending 队列/最近 op/错误），全部 HeroUI v3 |
| `src/lib/platform.ts` | API 地址解析：`VITE_API_BASE` 显式配置 → dev/preview 端口（5173/4173→8787）启发式 → 生产同源 `/api` |
| `src/lib/filters.ts` | 今天/最近7天/全部/回收站 的筛选排序 + `visibleTree` 子任务树（父不可见时子任务提升为顶层行，纯函数） |
| `src/lib/monthGrid.ts` | 月视图纯逻辑：周一起始的固定 6 行网格、按本地日分桶、溢出计数、「未排期」筛选、拖拽改期语义（纯函数） |
| `src/lib/recurrence.ts` | 重复任务到期滚动（本地时区保时刻、月/年末日收敛、周几组合）+ 规则中文摘要 |
| `src/lib/opSummary.ts` | op patch → 中文动作摘要（同步详情页展示） |
| `src/lib/usePullToRefresh.ts` | 移动端下拉刷新手势 hook（原生非 passive touch 监听 + 阻尼 + 阈值触发） |
| `src/lib/reminders.ts` | 到期本地通知调度（Tauri 通知插件 / Web Notification API） |
| `e2e/sync.spec.ts` | Playwright 端到端：真实服务端 + 双浏览器手动刷新同步 + 离线恢复 |

### `apps/client/` —— Tauri 2 壳（五端一个壳）

| 文件 | 职责 |
|---|---|
| `src/lib.rs` | 窗口 + 通知插件。**不含任何存储逻辑**——数据层在前端 WASM 里，壳只负责把 UI 装进各端 WebView |
| `tauri.conf.json` | `frontendDist` 指向 `../web/dist`；`beforeBuildCommand` 先 `pnpm build:wasm` 再构建前端 |
| `gen/android/` | Android 工程（`tauri android init` 生成，已入库）。国内镜像默认关闭，本地构建前设 `PLANWAVE_CN_MIRROR=1` 启用阿里云 Maven 加速 |
| `gen/ios/` | iOS 工程由 macOS runner 在 release.yml 里生成（Windows 无法 init） |

### 其他

- `deploy/`：两个镜像的 Dockerfile（web 镜像内含 Rust 阶段编译 WASM）+ compose（server 直接跑；web=nginx 静态+反代，只绑回环端口，交给宿主全局 Caddy）+ 部署手册
- `.github/workflows/`：`ci.yml`（push/PR 只跑 lint+test）、`release.yml`（仅 v* 标签：双镜像推 GHCR + 五端客户端传 GitHub Release）
- `scripts/free-ports.mjs`：清理固定端口（8787/4173）残留进程；`scripts/gen_icon.py` 图标生成
- `docs/APPLE_SIGNING.md`：macOS 签名+公证、iOS Ad Hoc 签名的 Secrets 配置指南

## 三、一次「勾选任务」的完整旅程

以在 Web 端勾选「买牛奶」为例：

```
① TaskRow 勾选框点击
   └→ store.toggleTask(id)                    apps/web/src/state/store.ts
② wasm.mutate("task", id, {"completed":true})  JSON 字符串过 JS/Rust 边界
③ PlanWaveClient::mutate（sync-wasm/src/lib.rs）
   └→ Client::mutate（sync-core/src/client.rs，纯 Rust）
      ├→ 本地时钟 +1，生成 op（uuid + 字段 patch）
      ├→ IdbStorage.apply_local()              IndexedDB 立即改，UI 马上更新
      └→ op 进入 pending_ops 队列（自增键保序）
④ 1.5s 防抖后 store.scheduleAutoSync → actions.refresh()
   └→ transport.push → POST /sync/push        批量送达；失败则留在队列
⑤ 服务端 sync_api::push（apps/server）
   └→ 校验 → MySQL 事务：给 op 分配全局 seq 写入 ops 表，同事务更新 tasks 投影
⑥ 推送成功后顺带 pull_all() → GET /sync/pull?since=上次位置
   └→ applyRemote()：seen 去重 + 字段级合并 → 本地库更新 → reload() → React 重渲染
   （其他端的对应触发：启动 / 窗口聚焦 / 前台 60s 轮询 / 手动刷新按钮）
⑦ 断网时：④ 失败，op 留在队列，徽章转「离线」；恢复后（online 事件或下次刷新）
   自动补推 → 走 ⑤⑥
```

冲突怎么办？两台设备同时改同一字段：各自 op 都会被服务端编号，**编号大的在后，后写的赢**（全序唯一，所有端看到同一个「后」）。改不同字段：互不覆盖，都生效。

## 四、30 分钟读懂核心的阅读顺序

1. `README.md` 的「同步协议」一节 + `docs/sync-model.svg`（5 分钟，建立全局观）
2. `crates/sync-core/src/model.rs` → `merge.rs` → `replay.rs` → `client.rs`（10 分钟，语义与引擎全在这）
3. `crates/sync-wasm/src/transport.rs` → `idb_storage.rs`（IO 落地，边界面很窄）
4. `apps/server/src/api/sync_api.rs`（服务端如何定序落地）
5. `apps/web/src/state/store.ts`（UI 怎么接进 WASM 引擎）

每层都有测试兜底：改语义前先看对应测试文件，能最快理解「设计者认为什么是对的」。

## 五、改需求速查表

| 想改什么 | 去哪里 | 注意 |
|---|---|---|
| 给任务加字段 | `sync-core/model.rs` 的 TaskPatch + merge 一处 + `apps/server/migrations` + 两个 store 实现 | **只改 Rust 一份**；JSON 契约测试锁定与服务端的字段一致性；三态字段（可清空）记得挂 `deserialize_set_field` |
| 改重复任务规则/滚动算法 | `sync-core/model.rs` 的 RecurrenceRule（数据）+ `apps/web/src/lib/recurrence.ts`（算法）+ `store.ts` 的 `materializeNextOccurrence`（物化行为） | 到期计算在各端 TS 侧（本地时区），Rust 只存结构 |
| 改子任务展示/嵌套规则 | `apps/web/src/lib/filters.ts` 的 `visibleTree` + TaskList/TaskDetail | 纯函数有单测；当前为单层嵌套 |
| 改同步详情页内容 | `crates/sync-wasm` 的 `sync_details`（数据面）+ `apps/web/src/components/SyncStatusSheet.tsx` | 最近 op 记录在 idb `recent_ops` 环形日志 |
| 改界面/交互 | `apps/web/src/components/` | 纯 UI（HeroUI v3），不碰同步 |
| 改视图逻辑（今天/最近7天…） | `apps/web/src/lib/filters.ts` | 纯函数，有单测 |
| 改月视图（网格/拖拽/未排期） | `apps/web/src/lib/monthGrid.ts`（纯逻辑）+ `apps/web/src/components/MonthView.tsx`（网格与 Pointer Events 拖拽）+ `UnscheduledTray.tsx` / `DayTasksOverlay.tsx` | 纯前端，不碰同步层；只认 `due_date`，无开始/结束时间 |
| 加服务端 API | `apps/server/src/api/` | 记得在 `api/mod.rs` 注册路由 |
| 改合并/冲突策略 | `sync-core/src/merge.rs` | 先改测试再改实现，随机化收敛测试会兜底 |
| 改刷新节奏（轮询间隔等） | `apps/web/src/state/store.ts` 的 `startPolling` / `scheduleAutoSync` | 拉取式的唯一「频率」旋钮 |
| 换数据库 | `apps/server/src/store/mysql.rs`（实现 `Store` trait 即可） | 内存实现可作参考 |
