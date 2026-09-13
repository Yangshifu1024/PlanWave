# 代码评审：回收站彻底删除（单个 + 勾选批量，forget op 协议扩展）

- 日期：2026-09-13
- 分支：`feature/trash-purge`（未提交工作区）
- 范围：`crates/sync-core`（model / merge / replay + 3 个测试文件）、`apps/server`（memory / mysql 双 store + api 集成测试）、`crates/sync-wasm`（lib / idb_storage）、`apps/web`（client.ts / store / TaskList / TaskRow / TaskDetail / PurgeConfirmDialog / purge.ts / App + vitest + e2e）
- 提案 / 方案：`docs/features/20260913-trash-purge.md` / `docs/tasks/feat-trash-purge/plan.md`

## 结论：✅ 通过，建议修复 🟡1 后合并（无 🔴 严重问题）

- **🔴 严重问题：0**
- **🟡 建议修复：4**
- **🟢 可选优化：4**

协议扩展的核心不变量经逐层核实成立：**「回放 ≡ 快照」在 forget 之后依然保持**。`Patch::TaskForget`（serde 标签 `task_forget`）经 `json_interop.rs` 字面用例冻结契约；`is_empty()` 对 forget 返回 `false` 使 `Op::validate` 正确放行（`is_empty` 的唯一消费方就是 validate，方向无误）；快照因投影行已删自动排除、oplog 照记全部 ops，均有服务端集成测试锁定。文档化的「forget 后同实体编辑 op 按 upsert 语义重建」边界在 replay / memory / mysql / IndexedDB / 测试 fake 五处实现完全一致（均为 `or_insert_with(task_defaults)` 落底），不是某一层的实现漂移。前端级联、确认弹框、批量 UI 与提案九项决策逐条对上。已验证门禁全绿（clippy -D warnings + eslint / cargo test / vitest 56 / build:web / e2e 3）。

---

## ✅ 优点

- **forget 语义五层一致，且有测试钉死**：`merge.rs:122` 的 `forget_task` 只做 `remove`（幂等）；`replay.rs:101-146` 两个新测试覆盖「upsert→forget→消失」与「forget 后编辑重建」；`apps/server/tests/api.rs:482-554` 集成测试一次锁定三个断言（快照排除被清实体、软删墓碑仍在、oplog 保留全部 4 条 op 含 `task_forget`）——这正是本特性最容易做错的三个点。
- **IndexedDB 页内缓存处理正确且巧妙**（`idb_storage.rs:388-395`）：forget 删记录后向 `task_cache` 写入 `Some(None)`，同页后续同实体 op 经 `unwrap_or_else(task_defaults)` 以默认值重建——与服务端投影、内核回放的 upsert 语义逐字对齐，不因「一页多 op」产生分叉。
- **`apply_local` 的 forget 臂只负责删记录**（`idb_storage.rs:458-460`）：seen_ops 去重、lamport 推进、recent_ops 环形日志、pending 入队全部走 match 之后的共享代码，forget op 不会漏入队、时钟不会漏推进；`reset_with_snapshot` 的 pending 重放臂（`idb_storage.rs:563-566`）「快照已不含该实体，重放 = 幂等再删」注释准确。
- **MySQL 事务语义正确**（`mysql.rs:184-309`）：op INSERT 与投影 DELETE 同事务，批内任一步失败整体回滚；op_id 幂等检查（`:189-198`）使「已提交但响应丢失」的重试返回既有 seq 且不重复执行 DELETE——首条 DELETE 语句的引入没有破坏 push 的原子与幂等承诺。
- **级联是纯函数**（`purge.ts`）：BFS + `seen` 集合防环 + 去重 + 父先于子 + 未知根兜底，5 个单测覆盖多层级/重复指向/空根/幽灵根/环引用；确认弹框与执行共用同一函数，展示条数与实际执行集合同源。
- **墓碑 UX 决策逐条落地**：行首完成勾选框替换为选择框（`TaskRow.tsx:66-80`）、删除线（`:102`）、详情面板禁用「已完成」开关（`TaskDetail.tsx:244`）均与提案决策 #5/#8 一致；确认弹框挂载模式与 `QuickAddModal` 相同（App 单点挂载 + 空态返回 null），条件渲染即生命周期，无状态残留。
- **e2e 是行为级断言**：单删（详情入口）/ 勾选批量 / 清空回收站三条流 + 跨端「A 彻底删除 → B 手动刷新后消失」（`sync.spec.ts` 用 `expect.poll` 轮询而非固定 sleep），全部走真实服务端。

---

## 分维度评审

### 1. 正确性 — 核心不变量成立，1 个 🟡（UI 选择集）

针对六项专项核查的结论：

1. **复活不变量**：不可能经正常路径复活。回放从 seq 0（upsert…forget → 消失）；快照引导（投影行已删 → 快照不含）；pull 回显（seen_ops 去重，本机 forget 不会被自己重放）；`reset_with_snapshot` 带 pending forget（幂等再删）；跨端按 seq 全序收敛。「forget 后同实体编辑 op 重建实体」经核实为**五处实现一致**的既有 upsert 语义延伸（注释 + replay 测试双文档化），且同设备 UI 上 purge 后详情面板关闭、行消失，不存在产生「forget 之后再编辑同实体」op 的入口——该边界只可能由**离线旧端迟到的 pending 编辑**触发，属可接受的有文档边界。注意重建出的实体是全默认值（空标题、`project_id: ""`），会以「幽灵空行」出现在「全部」视图——已知边界的表现形式，建议在 README 契约段一并写明（见 🟡2）。
2. **级联展开时点**：`purgeTasks` 在确认执行时从本地任务表展开（`store.ts:387`），若其他端在「展开 → 服务端落账」窗口内给被删父任务新增子任务，该子任务的 parent_id 悬挂、成为孤儿漂浮——展示层有兜底（`filters.ts:103-105` 孤儿提升为顶层行，不丢数据），但与确认弹框「级联删整棵树」的承诺有缝，且**未在任何文档记录**。见 🟡4。
3. **MySQL 事务性**：见优点第 4 条，无问题。回滚可能烧掉 auto_increment 序号产生 seq 空洞，但 pull 按 `seq > since` 递增过滤，序号空洞无影响（既有语义）。
4. **IndexedDB apply_remote**：见优点第 2 条，同页缓存 `Some(None)` 与后续 op 的交互正确；seen 标记与 meta（last_pulled_seq / lamport）在共享尾部代码，forget 臂不旁路。
5. **lamport/meta**：`apply_local` 新臂位于 match 首位、只做 `kv_delete`，之后的 seen/时钟/recent/入队共享代码对 forget 全部生效；客户端 lamport 由 `Client::mutate`（`client.rs:130-137`）在 apply_local 之前统一推进，无遗漏。
6. **UI**：选择集清理效应有一个真实缺口——🟡1；确认弹框条件挂载与 QuickAddModal 同模式；testids 完整（`trash-select-all` / `trash-clear` / `trash-bulk-bar` / `trash-bulk-delete` / `trash-bulk-cancel` / `trash-check-${title}` / `purge-${title}` / `detail-purge` / `purge-modal` / `purge-confirm` / `purge-cancel`）；UI 字符串全中文；**没有任何绕过 oplog 的变更路径**——purge 走 `client.forget` → `Client::mutate` → `apply_local` 入队，与 `toggleTask` 同管道。

其余：`openPurgeConfirm` 空集合守卫（`store.ts:377-379`）；重复 purge / 对已不存在实体 purge 因 forget 幂等而无害（只会多一条空操作 op）；`trash-clear` 用 `tasks.filter(t => t.deleted)` 而非可见集合，语义为「清空全部回收站」——见 🟢1；`collectDescendants` 对选中集合里互为祖先的 id 去重正确。

### 2. 安全性 — 无问题

无新端点；forget 复用既有 `/sync/push`，JWT 鉴权与 `Op::validate`（op_id/entity_id 必须 UUID）照常生效。SQL 为参数化查询，无注入面。`entity_kind` 在 wasm 边界白名单（`lib.rs:123-126`，仅 `"task"`，其余报错），project 无 forget 路径，符合本特性范围。任意设备可 forget 账号内任意实体——与单账号信任模型及「软删同理」一致。破坏性操作有确认弹框 + 级联条数前置披露，符合提案决策 #1/#6。

### 3. 性能 — 无问题，1 个 🟢

服务端 forget 是 O(1) 删行（memory HashMap / MySQL 主键 DELETE），且让快照随 purge 逐步瘦身（本特性的动机之一）。前端 `collectDescendants` O(n)；`trashSelected` 剪理效应 O(选中 × 任务数)，回收站规模下无虞。🟢2 记录逐条 forget 的 IndexedDB 事务放大问题。

### 4. 可维护性 — 良好，1 个 🟢

- 级联逻辑收敛为纯函数、确认态共享（TaskList 与 TaskDetail 双入口复用 `openPurgeConfirm`）、wasm 层提供显式 `forget` 入口而非复用 patch JSON 语义——与 plan.md 的分层决策一致。
- 🟢4：forget 的投影臂在 memory / mysql / IDB / 测试 fake 四处各自手写（均为一行 `remove`/`DELETE`）。这是跟随仓库既有模式（Task 臂本就四处落地），且 `merge.rs` 已导出 `forget_task` / `apply_patch` 可复用；本次不改合理，若未来投影语义再膨胀（如 project forget），建议评估让 memory store 直接走 `merge::apply_patch` 消除一处手写。

### 5. 可读性 — 良好，1 个 🟢

每处 forget 臂的注释都回答了「为什么 op 仍入账本 / 为什么幂等 / 同页后续 op 会怎样」，`model.rs:166-168` 把「forget 后编辑重建是既有语义延伸」写进了变体文档。🟢3：确认弹框文案「， 且」中混入半角空格。

### 6. 测试覆盖 — 良好，缺口随 🟡 记录

Rust 侧：merge 幂等三连、replay 全序两例、json_interop 契约冻结（含 `validate()` 对 forget 放行）、服务端集成（快照/墓碑/oplog 三断言）。web 侧：collectDescendants 5 例、确认弹框 5 例（条数/取消/确认入参）、TaskRow 墓碑分支 3 例、e2e 四条流。缺口：① 「勾选 → 恢复 → 选择集残留」无任何测试锁定（🟡1 的修复应伴随回归用例）；② 「forget 后编辑 op 重建投影」仅在 core replay 层验证，memory/mysql 投影臂对该边界无直接测试（语义与 core 共享，风险低，可选）；③ opSummary 对 forget 的展示无测试（随 🟡3）。

### 7. 最佳实践 — 良好

命中仓库惯例：HeroUI 复合 API（`Checkbox.Content/Control/Indicator`、Modal `Backdrop/Container/Dialog` 嵌套）、`onPress`、Tailwind `dark:` 变体、thiserror 错误链未破坏、无 `/api` 前缀改动、迁移零新增（快照排除靠投影删行自然达成，未引入 epoch/GC 复杂度——与提案决策 #2 一致）。三态 `deserialize_set_field` 未被触碰。

---

## 🔴 严重问题（必须修复）

无。

## 🟡 一般问题（建议修复）

1. **回收站选择集在任务「恢复」后不清理，可对已复活的存活任务发起彻底删除**
   - 位置：`apps/web/src/components/TaskList.tsx:44`（剪理效应）；`apps/web/src/state/store.ts:386-392`（`purgeTasks` 无 `deleted` 防御）
   - 描述：剪理条件是 `tasks.some((t) => t.id === id)`，只剔除「彻底不存在」的 id。墓碑被**恢复**后记录仍在 `tasks`（仅 `deleted: false`），其 id 会残留在 `trashSelected` 中：勾选 → 行内/详情「恢复」 → 该行从回收站消失，但批量条仍显示「已选 1 项」，此时点「删除所选」并确认，会把一个**已恢复的存活任务**（连同其子树）永久删除且跨端传播。确认弹框只显示条数不显示标题，用户难以察觉目标错误。
   - 建议：剪理条件补上删除态——`tasks.some((t) => t.id === id && t.deleted)`（一行修复）；并在 `purgeTasks`/`openPurgeConfirm` 入口对 `tasks.filter(t => t.deleted)` 做防御过滤（双保险）。修复后补一条回归测试（e2e：勾选 → 恢复 → 断言 `trash-bulk-bar` 消失，或把选择剪理抽成纯函数做 vitest）。

2. **plan.md 文档项未落实：README 软删契约段与 CODE_TOUR 未提及 forget/purge**
   - 位置：`README.md:70`（「删除是软删除墓碑……只有显式 `deleted: false` 才会」——现已不完整）；`docs/CODE_TOUR.md`（`model.rs`/`merge.rs` 职责行未提 forget）；对照 `docs/tasks/feat-trash-purge/plan.md` 改动清单第 6 条
   - 描述：技术方案明确承诺「更新 README.md 软删除契约段（补 purge）与 docs/CODE_TOUR.md 相关行」，本次 diff 未包含两者。README 现有表述会让读者以为删除只有软删一种终态；「forget 后编辑 op 重建实体」这一文档化边界也只存在于代码注释里。
   - 建议：README 契约段补一句彻底删除语义（含「不可恢复、全端移除、快照自动排除、oplog 照记」与「forget 后迟到编辑按 upsert 重建」边界）；CODE_TOUR 的 `model.rs`/`merge.rs`/store 行各补半句。

3. **同步详情页把 forget op 显示为「更新」**
   - 位置：`apps/web/src/lib/opSummary.ts:25-41`（`describePatch`）
   - 描述：`{"type":"task_forget"}` 不含任何 `TASK_FIELD_LABELS` 字段，循环后 `parts` 为空 → 返回兜底「更新」。彻底删除是破坏性最强的 op，在 SyncStatusSheet 的最近 op / pending 队列里与普通编辑无法区分，误导排障。
   - 建议：`describePatch` 开头对 `patch.type === "task_forget"` 早返回「彻底删除」，配一例 vitest。

4. **级联展开时点竞态未文档化：确认后其他端新增的子任务不随级联删除**
   - 位置：`apps/web/src/state/store.ts:387`（展开时点 = 本地确认时）；`docs/features/20260913-trash-purge.md` 决策 #3（未提此边界）
   - 描述：级联集合在确认执行时从本地任务表计算；另一设备若在「展开 → forget 落账」窗口内向被删父任务新增子任务，该子任务的 forget op 不会被发出，成为 parent_id 悬挂的孤儿。展示层有兜底（`filters.ts:103-105` 提升为顶层行，数据不丢），但与确认弹框「级联删整棵树」的承诺存在缝，且该边界目前既无代码注释也无提案记录，未来容易被当成 bug 上报或被误「修」。
   - 建议：在提案决策 #3（或 README 契约段）补一行已知边界：「级联按发起端确认时刻的树计算；竞态窗口内其他端新增的后代成为孤儿任务并漂浮到顶层」。服务端级联可留作 future work 不做。

## 🟢 优化建议（可选）

1. `apps/web/src/components/TaskList.tsx:166-170` — 「清空回收站」取 `tasks.filter(t => t.deleted)`（全部墓碑），不受回收站搜索框影响：搜索「甲」后点清空会连未命中的乙丙一起删。弹框条数已披露总数，语义上也说得通（「清空」≠「删除所见」），建议知悉即可；若要更保守可改为对 `tree` 可见集合操作。
2. `apps/web/src/state/store.ts:388-390` — `purgeTasks` 逐条 `await client.forget`，每条 op 落 4-5 次 IndexedDB 事务（kv_delete/seen/meta/recent/enqueue）；「清空回收站」数百条墓碑时本地应用阶段可能达秒级（推送本身已分批，无碍）。若未来反馈卡顿，可考虑 `apply_local` 批量化或 `forgetMany` 入口。当前规模可接受。
3. `apps/web/src/components/PurgeConfirmDialog.tsx:38` — 文案「将同步从所有设备移除， 且」中逗号后混入半角空格，删掉即可。
4. 见「可维护性」：forget 投影臂四处手写属既有模式的延续；未来若新增 forget 实体类型，优先考虑让内存 store 复用 `merge::apply_patch`，避免第五份手写。

## 📝 总体评价

这是一次边界处理扎实的同步协议扩展：最难做对的「回放 ≡ 快照」「同页多 op」「事务 + 幂等重试」「五层重建语义一致」四个点全部经得起逐层核对，且测试锁定在正确的层级（core 锁语义、api 锁投影、e2e 锁行为）。建议合并前处理 🟡1（一行剪理修复 + 回归用例，堵住「误删已恢复任务」的唯一入口）与 🟡2（README 契约段补全，成本极低且是计划承诺项）；🟡3/🟡4 可作为紧随其后的小改进。

---

## 修复记录（评审后跟进）

- ✅ **🟡1 已处理**：两层防御——① `TaskList` 勾选剪理条件收紧为 `t.id === id && t.deleted`（恢复后的活任务立即移出勾选集）；② `store.purgeTasks` 执行前再过滤，只对仍是墓碑的根做级联展开，全部根失效时直接关弹框不产生任何 op。
- ✅ **🟡2 已处理**：`README.md` 收敛与冲突段（第 10 条）补 forget 彻底删除契约（含「forget 后同实体编辑按 upsert 重建」的语义说明）；`docs/CODE_TOUR.md` merge.rs 行补 forget 投影语义。
- ✅ **🟡3 已处理**：`opSummary.describePatch` 对 `task_forget` 提前返回「彻底删除」，同步详情页不再显示为「更新」。
- ✅ **🟡4 已处理**：级联竞态、forget 后编辑重建、oplog 保留三项已知边界写入提案 `docs/features/20260913-trash-purge.md`「已知边界」一节。
- ✅ **🟢3 已处理**：弹框文案重写为「将彻底删除 N 个任务（含 M 个子任务），操作会同步从所有设备移除，且不可恢复。」——去除逗号后半角空格，连带消除 JSX 断行空格问题。
- ⏸ **🟢1/🟢2/🟢4 知悉暂缓**：清空回收站不受搜索过滤（语义为「清空全部」，弹框已披露总数）；逐条 forget 的本地事务开销当前规模可接受；forget 投影臂四处手写与既有模式一致，新增实体类型时再收敛。
- **复验**：`pnpm lint` / `tsc --noEmit` / vitest 56 / e2e 3 / `pnpm test:rust` 全绿。
