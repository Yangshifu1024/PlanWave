# 技术方案：列表页显示效果优化

- 日期：2026-09-14
- 提案：`docs/features/20260914-task-list-visual-refresh.md`
- 分支：`feature/task-list-visual-refresh`

## 需求映射

| 需求 | 落点 |
|---|---|
| 内嵌发丝分隔线 | `TaskRow.tsx` 新增 `showDivider` + `before:` 伪元素 |
| 子任务树 | `TaskList.tsx` 子任务容器画引导线；`TaskRow.tsx` 去掉 `border-l` |
| 时间分组 | `filters.ts` 新增 `dueBucket` / `groupByDue`；`TaskList.tsx` 渲染分组 |
| 已完成分区 | `filters.ts` 新增 `splitCompleted`；`TaskList.tsx` 折叠区 + localStorage |
| 即时勾选 + 撤销 | `store.ts` 新增 `toggleTaskWithUndo`；`App.tsx` 挂 `Toast.Provider`；`TaskRow.tsx` 改调用 |

## 1. 纯逻辑 `apps/web/src/lib/filters.ts`

新增导出（不改动既有 `sortTasks`/`filterTasks`/`visibleTree`/`subtaskProgress`）：

```ts
export type DueBucket = "overdue" | "today" | "tomorrow" | "thisWeek" | "later" | "none";
export const DUE_BUCKET_ORDER: DueBucket[] = [...];
export const DUE_BUCKET_LABELS: Record<DueBucket, string>; // 逾期/今天/明天/7 天内/以后/无日期

export function dueBucket(task: TaskRecord, now = new Date()): DueBucket;
export interface TaskGroup { key: DueBucket; label: string; nodes: TaskTree[]; }
export function groupByDue(nodes: TaskTree[], now = new Date()): TaskGroup[];
export function splitCompleted(nodes: TaskTree[]): { active: TaskTree[]; completed: TaskTree[] };
```

- `dueBucket`：按本地时区「日差」`Math.round((startOfDay(due) - startOfDay(now)) / 86400000)`：
  `<0` 逾期、`0` 今天、`1` 明天、`2..7` 7 天内、`>7` 以后、`due_date === null` 无日期。
- `groupByDue`：按顶层节点分桶，按 `DUE_BUCKET_ORDER` 排序，**空桶不产出**；桶内保持入参顺序（调用前已完成 `sortTasks`）。
- `splitCompleted`：顶层节点 `task.completed` 决定归属（父完成 → 整棵子树进已完成区）。

## 2. `apps/web/src/components/TaskRow.tsx`

- 新增可选 prop `showDivider?: boolean`。
- 行容器加 `relative`；`showDivider` 时拼 `before:absolute before:bottom-0 before:left-11 before:right-3 before:h-px before:bg-zinc-200/70 before:transition-opacity group-hover:before:opacity-0 dark:before:bg-zinc-800`；
  选中行额外 `before:opacity-0`。
- 去掉 `isSubtask` 的 `border-l border-zinc-200 pl-2.5`，保留 `ml-9`；子任务标题 `text-[13px] text-zinc-500 dark:text-zinc-400`，非子任务保持 `text-sm`。
- 完成勾选：`actions.requestConfirm({...})` → `actions.toggleTaskWithUndo(task.id)`（墓碑多选框与删除按钮不变）。
- 其余（优先级圆点 `span[title='优先级：高']`、标签、截止、进度、删除按钮）保持不变，e2e 依赖的 `data-testid`/`data-task-title` 不动。

## 3. `apps/web/src/components/TaskList.tsx`

- 派生：`searching = search.trim().length > 0`；`showGroups = !isTrash && !searching`；
  `{ active, completed } = splitCompleted(tree)`；`groups = groupByDue(active)`；
  `showCompleted` 状态由 `localStorage`（`planwave.ui.showCompleted`）初始化，切换时写回。
- 抽出 `renderNode(node)`：渲染顶层 `<li className="relative">` + `TaskRow`（`showDivider = !isTrash && !task.deleted`）；
  有展开子任务时在其下渲染引导线容器：
  - 竖向引导线：`absolute left-6 top-1 bottom-1 w-px bg-zinc-200 dark:bg-zinc-700`
  - 每个子任务行：`<li className="relative">` + 肘线 `absolute left-6 top-1/2 h-px w-2.5` + `TaskRow isSubtask`
- 列表 `<ul data-testid="task-list">` 内渲染顺序：
  1. `searching` → `tree.map(renderNode)`（平铺，含已完成）；
  2. 否则 `groups`：分组标题 `<li data-testid="group-<key>">`（标签 + 数量）+ `group.nodes.map(renderNode)`；
  3. 若 `completed.length > 0`：整宽分隔 + 按钮 `<li>`（`data-testid="completed-toggle"`，`aria-expanded`）
     + `showCompleted` 时 `completed.map(renderNode)`；
  4. 空态：`searching ? tree.length === 0 : active.length + completed.length === 0`。
- 回收站分支完全沿用现状（平铺 + 多选 + 清空），不分组不分已完成。
- 空态文案、搜索框、工具行、下拉刷新保持不变。

## 4. `apps/web/src/state/store.ts` + `apps/web/src/App.tsx`

- `store.ts`：`import { toast } from "@heroui/react"`；新增
  `async toggleTaskWithUndo(id)`：读取任务 → 记录 `wasCompleted` → `await actions.toggleTask(id)` →
  `toast(文案, { timeout: 5000, actionProps: { children: "撤销", onPress: () => void actions.toggleTask(id) } })`。
- `App.tsx`：在根 fragment 内挂 `<Toast.Provider placement="bottom" />`（使用全局 `toastQueue`，无需自建队列）。

## 5. 测试

- `tests/filters.test.ts`：新增 `dueBucket` 全桶、`groupByDue`（空桶省略/today 子集）、`splitCompleted`（父完成带走子树）。
- `tests/task-row.test.tsx`：勾选改为断言 `toggleTaskWithUndo` 被调（不再 `requestConfirm`）；补 `showDivider` 类名断言；mock store 增加 `toggleTaskWithUndo`。
- 新增 `tests/task-list.test.tsx`（mock store + mock 子组件较重，改为 mock `TaskRow`）：分组标题渲染、已完成默认折叠与展开、搜索平铺、回收站平铺。
- `e2e/sync.spec.ts`：
  - 勾选完成处去掉 `acceptConfirm`；
  - 完成后的删除线断言前先点 `completed-toggle` 展开（两处：首测、双端测试的 A 端）。

## 6. data-testid 清单（新增）

`group-overdue` / `group-today` / `group-tomorrow` / `group-thisWeek` / `group-later` / `group-none` /
`completed-toggle` / `completed-section`

## 验证门禁

`pnpm build:wasm` → `pnpm lint` → `pnpm typecheck` → `pnpm test:web` → `pnpm build:web` → `pnpm test:e2e`。
纯前端改动，不碰 Rust / 同步层 / JSON 契约。按 AGENTS.md 不自动 commit/push。
