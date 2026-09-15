# 技术方案：月视图（全部 + 各项目）

- 日期：2026-09-15
- 提案：`docs/features/20260915-month-view.md`
- 分支：`feature/month-view`

## 需求映射

| 需求 | 落点 |
|---|---|
| 列表/月 切换器 | 新 `components/ViewModeToggle.tsx`；`TaskList.tsx` 头部渲染 |
| 模式状态与持久化 | `state/store.ts`：`viewMode` + `setViewMode` + `planwave.ui.viewMode` |
| 月网格纯逻辑 | 新 `lib/monthGrid.ts`（周一起始、固定 6 行、按本地日分桶、溢出计数、未排期筛选） |
| 网格与拖拽 | 新 `components/MonthView.tsx`（自绘网格 + Pointer Events 拖拽） |
| 未排期抽屉 | 新 `components/UnscheduledTray.tsx`；`store.ts` 的 `unscheduledOpen` |
| 当天任务浮层 | 新 `components/DayTasksOverlay.tsx`（复用 `TaskRow`） |
| 新建预填日期 | `QuickAddModal.tsx` 增加可选 `dueDate` prop |
| 改期 + 撤销 | `store.ts` 新增 `rescheduleTaskWithUndo` |

## 1. 纯逻辑 `apps/web/src/lib/monthGrid.ts`

```ts
export const MONTH_CELL_MAX = 3;

export interface MonthDay {
  date: Date;      // 本地当天零点
  key: string;     // yyyy-MM-dd（本地）
  day: number;     // 1..31
  inMonth: boolean;
  isToday: boolean;
  tasks: TaskRecord[];   // 已排序（sortTasks）
  overflow: number;      // max(0, tasks.length - MONTH_CELL_MAX)
}
export interface MonthGrid { year: number; month: number; days: MonthDay[] } // days 恒 42

export function dayKey(d: Date): string;
export function addMonths(d: Date, n: number): Date;
export function monthTitle(year: number, month: number): string;   // "2026 年 9 月"
export function buildMonthGrid(
  tasks: TaskRecord[],
  year: number,
  month: number,
  opts?: { showCompleted?: boolean; now?: Date },
): MonthGrid;
export function unscheduledTasks(tasks: TaskRecord[], view: ViewKind, now?: Date): TaskRecord[];
export function dueTimeLabel(ms: number | null): string | null;  // "HH:mm"，整点 00:00 返回 null
```

- **可见任务**：先 `filterTasks(tasks, view, "", now)`（复用既有视图过滤），再取
  `isGridTopLevel(t)`（`parent_id === ""`，或父缺失/已删的孤儿 —— 与 `visibleTree` 的提升规则一致），
  再按 `showCompleted` 过滤已完成。
- **周一起始**：`first = new Date(y, m, 1)`，`offset = (first.getDay() + 6) % 7`，网格起点 = `first - offset` 天。
- **分桶**：`due_date !== null` 的任务按 `dayKey(startOfDay(new Date(due_date)))` 入桶；桶内 `sortTasks`。
- **未排期**：`filterTasks` 后取网格顶层任务且 `due_date === null` 且 `!completed`，按 `sortTasks` 排序。

## 2. `apps/web/src/state/store.ts`

- 新增类型 `export type ViewMode = "list" | "month";`
- `AppState` 增加 `viewMode: ViewMode`（初值读 `localStorage.getItem("planwave.ui.viewMode") === "month" ? "month" : "list"`）
  与 `unscheduledOpen: boolean`（初值 `localStorage.getItem("planwave.ui.unscheduledOpen") !== "false"`）。
- `actions.setViewMode(mode)`：写 `localStorage` 并把 `viewMode` 与 `search: ""` 一并落状态
  （切回月视图清空搜索）。
- `actions.setSearch(search)`：若 `search.trim()` 非空且当前 `viewMode === "month"`，**仅当次**把 `viewMode` 置回
  `list`（不写 `localStorage`，偏好仍是月）。
- `actions.toggleUnscheduled()`：翻转并持久化 `planwave.ui.unscheduledOpen`。
- `actions.rescheduleTaskWithUndo(id, dueDate)`：记录原 `due_date` → `patchTask(id, { due_date: dueDate })`
  → `toast`（`dueDate === null` 文案「已移出日程」，否则「已改期到 M 月 D 日」）带「撤销」按钮回滚原值。

## 3. `apps/web/src/components/MonthView.tsx`

- 本地状态：`anchor: { year; month }`（初值当前月）、`pending: { title; dueDate } | null`（新建弹框）、
  `overlayDay: MonthDay | null`。
- 头部：`‹ 2026 年 9 月 ›` + 「今天」按钮；`now` 由 `useState(() => new Date())` 固定，避免每渲染变。
- 派生：`grid = buildMonthGrid(tasks, anchor.year, anchor.month, { showCompleted })`；
  `unscheduled = unscheduledTasks(tasks, view)`（桌面抽屉用）。
- `showCompleted` 读 `planwave.ui.showCompleted`（与 `TaskList` 同 key，默认 false）。
- **格子**：
  - 桌面（`md:` 及以上）：`TaskChip` 列表（最多 3）+ 「+N」按钮；点击空格子 → `setPending({ title: "", dueDate: day.date.getTime() })`。
  - 移动端：只渲染圆点（数量 ≤ 3 个点，超出显示数字）与日期数字；点击格子 → `setOverlayDay(day)`。
  - 窄屏判定用 `window.matchMedia("(min-width: 768px)")`（jsdom 无 matchMedia 时按桌面处理）。
- **TaskChip**：`priority dot + 项目色点 + 标题 + 可选 HH:mm + 重复图标`；逾期文字红。
  事件全部走 Pointer Events（不用 `onClick`）：
  - `pointerdown` 记录起点并 `setPointerCapture`；
  - `pointermove` 位移 > 4px 进入拖拽态，`document.elementFromPoint(...).closest("[data-drop-key]")` 求目标格；
  - `pointerup`：拖拽态且命中 → `actions.rescheduleTaskWithUndo(id, dueForDay(task, day))`；否则 `actions.selectTask(id)`。
- **拖拽态**：拖拽中根容器 `select-none`；源条目 `opacity-60 shadow-lg`；命中格 `ring-2 ring-blue-400`。
- 拖拽期间移动端不生效（圆点无 chip 可抓，天然不触发）。

## 4. `apps/web/src/components/UnscheduledTray.tsx`

- 仅桌面渲染（`hidden lg:flex`，宽 240px，右侧固定）；头部「未排期 (N)」+ 折叠按钮
  （`store.unscheduledOpen`）。
- 每条为 `TaskChip`（可拖出）；整栏是 drop 区：`data-drop-key=""`，落到此处即 `due_date: null`。
- 空态文案「没有未排期的任务」。

## 5. `apps/web/src/components/DayTasksOverlay.tsx`

- props：`{ title, tasks, projects, onClose, onAdd }`。
- `Modal` 壳，`Modal.Container placement={narrow ? "bottom" : "center"}`，`data-testid="day-tasks-overlay"`。
- 内容：`TaskRow` 列表（外层 `onClick` 冒泡后关浮层，随后详情面板打开）；空态「这天没有任务」；
  底部「添加任务到这天」（`data-testid="day-add-task"`）→ 关闭浮层并回调 `onAdd`。

## 6. `apps/web/src/components/ViewModeToggle.tsx`

- 两个按钮 `列表` / `月`（`data-testid="view-mode-list"` / `view-mode-month"`，`aria-pressed`），
  选中态 `variant="primary"`，否则 `variant="ghost"`。

## 7. `apps/web/src/components/TaskList.tsx` + `QuickAddModal.tsx`

- `TaskList`：`const monthSupported = view.kind === "project" || view.smart === "all";`
  `const showMonth = monthSupported && viewMode === "month";`
  标题行右侧渲染 `ViewModeToggle`（仅 `monthSupported`）；`showMonth` 时不渲染搜索框以下的列表体，
  改渲染 `<MonthView />`（顶部搜索/刷新/同步徽章保留）。
- `QuickAddModal`：props 改为 `{ title, dueDate = null, onClose }`；`draft.due` 初值改
  `toDateInput(dueDate)`；其余不动（现有调用点不传即行为不变）。

## 8. 测试

- 新增 `tests/month-grid.test.ts`：周一起始/固定 42 天、跨月补位日归属、闰月与年末、按本地日分桶、
  溢出计数、顶层过滤（子任务不占格、孤儿提升）、`showCompleted` 开关、`unscheduledTasks` 视图隔离与排除已完成、
  月末 `03:00` 的 `due_date` 不被时区偏移挪到相邻日。
- 新增 `tests/month-view.test.tsx`（mock store + mock `TaskRow`/`DayTasksOverlay`）：网格渲染 42 格、
  今天高亮、点击空格触发新建弹框且预填日期、点「+N」打开当天浮层、切换器的 `setViewMode` 调用。
- 新增 `tests/day-tasks-overlay.test.tsx`：列出任务、空态、点条目关浮层、点「添加任务到这天」回调。
- `tests/task-list.test.tsx`：补「`全部` 视图显示切换器」「`today` 视图不显示切换器」「`viewMode==="month"`
  时渲染月视图而非列表体」。
- E2E `e2e/month-view.spec.ts`（新增，`describe.serial`）：切到月视图 → 点今天空白格新建（校验弹框日期预填）→
  格内勾选完成 → 鼠标 `mouse.down/move/up` 拖动改期并断言旧格消失、新格出现（撤销 Toast 后回滚）。

## 9. data-testid 清单（新增）

`view-mode-list` / `view-mode-month` / `month-view` / `month-title` / `month-prev` / `month-next` / `month-today` /
`month-day-<yyyy-MM-dd>` / `month-day-count-<yyyy-MM-dd>` / `month-more-<yyyy-MM-dd>` /
`month-chip-<title>` / `month-check-<title>` /
`unscheduled-tray` / `unscheduled-toggle` / `unscheduled-chip-<title>` / `day-tasks-overlay` / `day-add-task`

## 验证门禁

`pnpm lint` → `pnpm typecheck` → `pnpm test:web` → `pnpm build:web` →（可选）`pnpm test:e2e`。
纯前端改动，不碰 Rust / 同步层 / JSON 契约。按 AGENTS.md 不自动 commit/push。
