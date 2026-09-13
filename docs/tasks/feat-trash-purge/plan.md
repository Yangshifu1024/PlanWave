# 技术方案：回收站彻底删除（forget op 协议扩展 + 回收站批量 UI）

- 日期：2026-09-13
- 提案：`docs/features/20260913-trash-purge.md`（含九项决策）
- 分支：`feature/trash-purge`

## 改动清单

### 1. crates/sync-core（协议内核）

- `model.rs`：Patch/Op 层新增 forget 变体（单元变体，无字段 patch 体；`Op::validate`
  为其放行——空 patch 校验仅针对字段补丁）。**三处契约锁步**：Rust model +
  `apps/web/src/types.ts` TS 侧 + `crates/sync-core/tests/json_interop.rs` 字面用例。
- `merge.rs`：apply 增加 forget 分支——从 ReplayState 移除该实体；单测：
  ① upsert→forget 回放后实体消失；② forget 未知 id 幂等无副作用；③ 历史 upsert op
  （顺序在 forget 前）回放不复活已 forget 实体（回放顺序天然保证）。
- `replay.rs`/`client.rs`：forget 作为普通 op 参与 push/pull/回放；`pull_all` 兜底回放
  同样收敛到「已清除」。

### 2. apps/server（双 store）

- `store/memory.rs`：push 应用 forget → 从投影 HashMap 移除（op 照记，历史不清）。
- `store/mysql.rs`：同一事务 `DELETE FROM tasks WHERE id=?` + INSERT op（全仓库首条
  DELETE，属预期）。
- 快照自动排除（投影行已删）→「回放≡快照」保持；无新端点、无迁移。

### 3. crates/sync-wasm

- `PlanWaveClient` 新增显式 `forget(entity_kind, entity_id)` 变更入口（不走 patch JSON
  语义），wasm-bindgen 导出。
- `idb_storage.rs`：本地 apply forget = 删 IndexedDB 记录 + op 入队；远端 apply forget =
  删 IndexedDB 记录（新增单条删除路径，现有仅整库 reset）。

### 4. apps/web（前端）

- `lib/purge.ts`：纯函数 `collectDescendants(tasks, rootIds)` 沿 `parent_id` 展开后代
  全集（含 deleted 与存活后代），供级联与确认条数使用；vitest 覆盖。
- `store.ts`：action `purgeTasks(ids)`（展开级联 → 逐实体 forget → `afterMutate()`）；
  共享确认态 `purgeConfirm: { ids: string[] } | null` + open/cancel actions（TaskList 与
  TaskDetail 双入口共用）。回收站选择状态留在 TaskList 本地 state。
- `TaskList.tsx`（isTrash）：标题区工具行（表头全选 `trash-select-all` + 清空回收站
  `trash-clear`）；选中 >0 时批量条「删除所选（N）」`trash-bulk-delete`。
- `TaskRow.tsx`（deleted 行）：行首完成勾选框 → 选择框 `trash-check-${title}`；恢复旁
  悬停「彻底删除」`purge-${title}`；墓碑标题加删除线。
- `TaskDetail.tsx`（deleted 分支）：加「彻底删除」`detail-purge`；「已完成」开关禁用。
- `PurgeConfirmDialog.tsx`：HeroUI Modal（Backdrop 嵌套结构），文案含条数与级联数；
  testids `purge-modal` / `purge-confirm` / `purge-cancel`。

### 5. 测试矩阵

- Rust：merge forget 三例、json_interop 新用例、服务端 api（push forget → 投影消失、
  快照排除、回放等价）。
- vitest：collectDescendants、TaskRow 回收站分支、确认弹框。
- e2e：测试 1 扩展回收站段（单删确认/勾选批量/全选清空）；测试 2 跨端断言（A 彻底删除
  → B 刷新后消失）。

### 6. 文档

- 更新 `README.md` 软删除契约段（补 purge）与 `docs/CODE_TOUR.md` 相关行（如涉及）。

## 验证门禁

`pnpm lint` → `pnpm test:rust` → `pnpm test:web` → `pnpm build:web` → `pnpm test:e2e`
全绿；不自动 commit。
