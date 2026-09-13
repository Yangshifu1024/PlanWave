# 技术方案：添加任务流程优化（回车后弹出详情表单）

- 日期：2026-09-13
- 提案：`docs/features/20260913-quick-add-detail-form.md`
- 分支：`feature/quick-add-detail-form`

## 需求映射

1. **移除优先级选择** → 删除 `TaskList.tsx` 中输入框旁的原生 `<select>` 及 `priority` state。
2. **回车弹出详情表单** → `submit` 不再直接 `addTask`，改为打开新建弹框组件 `QuickAddModal`。
3. **关闭/保存 + 校验** → 弹框底部「关闭」（ghost）+「保存」（primary）两按钮；点击保存时校验，
   标题为空则显示内联红色错误并阻止创建。

## 决策（见提案）

- 关闭 = 放弃创建（含 Esc、点遮罩，react-aria `isDismissable` 默认开启）。
- 表单字段（精简版）：标题（预填）、优先级、截止日期、备注、所属项目（默认当前视图）、标签。
- 新建分支 `feature/quick-add-detail-form`。

## 改动清单（纯前端 `apps/web`，不碰 Rust/同步层——所有字段 `TaskPatch` 已支持）

### 1. `apps/web/src/state/store.ts` — 扩展 `addTask`

- 新增导出类型 `NewTaskInput { title; projectId?; priority?; dueDate?; notes?; labels? }`。
- `addTask(input)`：patch 沿用「有值才带 key」风格——`due_date` 非空、`notes` 非空、
  `labels` 非空数组时才写入；`title`/`sort_order`/`project_id`/`priority` 逻辑不变。
  `projectId` 语义：不传 = 跟随当前视图；空串 = 显式收集箱。

### 2. `apps/web/src/components/TaskList.tsx`

- 删 select 与 `priority` state；`submit`：`draft.trim()` 非空 → 记录标题并打开弹框
  （本地 state `pendingTitle: string | null`，符合「临时状态留组件」惯例），输入框清空。
- 更新文件头注释与 placeholder（「添加任务，回车确认」→「添加任务，回车填写详情」）。

### 3. 新组件 `apps/web/src/components/QuickAddModal.tsx`

- HeroUI Modal 复合 API（3.2.5，已核实 d.ts 与运行时实现）：
  `<Modal isOpen onOpenChange>`（内部是 react-aria `DialogTrigger`，可控式）+
  `Modal.Backdrop(isDismissable 默认 true)` / `Modal.Container(placement="center")` /
  `Modal.Dialog` / `Modal.Header/Body/Footer`。Esc/遮罩关闭走 `onOpenChange(false)` = 放弃。
- 条件挂载（`pendingTitle !== null` 才渲染），草稿 state 以 props 初始化，关闭即卸载，
  与仓库现有浮层（SyncStatusSheet 等）先例一致。
- 字段复用 TaskDetail 控件模式：优先级分段按钮（`PRIORITIES` 从 TaskDetail 导出复用）、
  native `<input type="date">` + 清除按钮（`lib/dates.ts` 的 `fromDateInput`）、
  TextArea 备注、HeroUI `Select` 项目（含「收集箱（无项目）」，与 TaskDetail 同一控件，
  评审 🟡3 统一后确认）、标签逗号分隔 Input（同 `/[,，]/` 解析）。
- 保存校验：标题 trim 非空；失败 → 字段下方 `text-sm text-red-500` 错误文案
  「标题不能为空」（AuthScreen 同款）、聚焦标题框、不关闭不创建；
  通过 → `actions.addTask({...})` 后 `onClose()`。
- 保存按钮 `type="submit"`（HeroUI Button 基于 react-aria，透传），整弹框一个 `<form>`，
  输入框内回车也能提交。

### 4. `TaskDetail.tsx`

- `PRIORITIES` 与 `Field` 帮助组件加 `export` 供 QuickAddModal 复用（无循环依赖）。

### 5. 测试

- e2e `apps/web/e2e/sync.spec.ts`：三处「fill + Enter → 断言行可见」（L52-54、L104-106、
  L139-141）在 Enter 后补「弹框出现 → 点 `new-task-save` → 断言」；首测补充空标题校验
  与「关闭 = 放弃」两个断言块；其余详情面板步骤不动。
- 新增 vitest `apps/web/tests/quick-add-modal.test.tsx`（mock store 模块，仿
  `task-row.test.tsx`）：标题预填；空标题保存 → 错误文案 + 不调 `addTask` + 弹框不关；
  正常保存 → `addTask` 收到完整字段且 `onClose` 被调；点关闭 → 不调 `addTask`。

### 6. data-testid 清单

`new-task-modal` / `new-task-title` / `new-task-priority` / `new-task-due` /
`new-task-project` / `new-task-labels` / `new-task-notes` / `new-task-save` /
`new-task-close` / `new-task-error`

## 验证门禁

`pnpm build:wasm`（pkg 缺失时）→ `pnpm lint` → `pnpm typecheck` → `pnpm test:web` →
`pnpm build:web` → `pnpm test:e2e`（真实 server 全流程验证新交互）。Rust 侧零改动。
按 AGENTS.md 不自动 commit/push。
