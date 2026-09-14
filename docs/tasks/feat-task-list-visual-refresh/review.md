# 代码评审：列表页显示效果优化（分隔线 / 子任务树 / 时间分组 / 已完成分区）

- 日期：2026-09-14
- 分支：`feature/task-list-visual-refresh`（未提交工作区）
- 范围：`apps/web`（`lib/filters.ts`、`components/TaskRow.tsx`、`components/TaskList.tsx`、`state/store.ts`、`App.tsx` + vitest ×3 + e2e）+ 文档两份
- 提案 / 方案：`docs/features/20260914-task-list-visual-refresh.md` / `docs/tasks/feat-task-list-visual-refresh/plan.md`

## 结论：✅ 通过（🔴1 已在本次评审中修复）

- **🔴 严重问题：1（已修复）**
- **🟡 建议修复：4**
- **🟢 可选优化：4**

本次改动是纯前端展示层重构，边界控制良好：分组与完成态拆分抽成三个纯函数（`dueBucket` / `groupByDue` / `splitCompleted`）并配 8 条单测；未触碰 Rust、同步语义与 JSON 契约；回收站、详情面板确认逻辑、既有 `data-testid` 全部保持。两条「看似可疑」的写法已用构建产物核实无误——① Tailwind `before:` 伪元素是否渲染：产物 CSS 中 `.before\:bg-zinc-200\/70:before{content:var(--tw-content);…}`，`content` 由 Tailwind v4 自动注入，分隔线真实可见；② 全局 Toast 区域是否遮挡交互：`.toast-region{pointer-events:none}`，空态不拦截点击，且 `Toast.Provider` 绑定的是 `toast()` 写入的同一 `toastQueue` 实例。已复验 `pnpm lint` / `tsc --noEmit` / vitest 79 全绿。

---

## ✅ 优点

- **派生逻辑与渲染分离**：`filters.ts` 只新增 `dueBucket` / `groupByDue` / `splitCompleted` 三个纯函数（`filters.ts` 末段），`TaskList` 只做组合渲染；分组在 `visibleTree`（子任务树）之上对**顶层节点**操作，父任务的桶天然携带其子树、孤儿子任务按自身截止时间入桶，未破坏既有 `visibleTree` 语义，且 `filters.test.ts` 新增 8 例覆盖全桶、空桶省略、today 子集、父决定子、父完成带走子树。
- **改动的副作用面被刻意收窄**：详情面板的完成/删除确认、回收站多选/批删/清空、`subtaskProgress`、`data-taskid`/`data-task-title` 全部未动，e2e 依赖的定位器不受影响；子任务引导线画在 `TaskList` 的容器上，`TaskRow` 只保留 `ml-9` 与文字层级，避免了「边框被圆角与行距切碎」的旧问题（`TaskRow.tsx:66`）。
- **分隔线的交互态设计正确**：`.group` 行内以 `before:` 画内嵌线，`group-hover:before:opacity-0` + 选中行 `before:opacity-0`，悬停/选中时线条隐去、圆角高亮呈胶囊感，符合 Material 3「inset divider + 悬停弱化」的调研结论；且只在顶层存活任务显示（`showDivider={!isTrash && !task.deleted}`，`TaskList.tsx:110`），子任务与墓碑不画线。
- **「已完成」分区是纯 UI 折叠 + 偏好持久化**：不引入新的任务状态，不改动 `filterTasks`（today/upcoming 本就不含已完成），默认折叠、`localStorage` 记忆，符合 Todoist「Display → Completed」范式；搜索时退化为平铺（`isTrash || searching` 分支），避免分组与搜索叠加的噪音。
- **e2e 是行为级而非类名级断言**：勾选后先等 `completed-toggle` 出现、展开、再断言删除线；双端用例在 A 端展开已完成后才轮询「删除传播」，并额外让 B 端展开已完成，堵住「折叠隐藏导致删除断言侥幸通过」的漏洞（`sync.spec.ts`）。
- **撤销 Toast 的接线经核实可用**：`toggleTaskWithUndo` 走既有 `toggleTask`（同一 oplog 管道），`Toast.Provider` 挂载于 App 根，全局 `toast()` 与 Provider 共用队列；`actionProps.children` 会被 `ToastActionButton` 渲染（读源码确认）。

---

## 分维度评审

### 1. 正确性 — 1 个 🔴（已修复），若干边界记录

1. **重复任务撤销会残留物化实例（🔴1，已修复）**：`toggleTask` 在完成带 `recurrence` 的任务时会 `materializeNextOccurrence` 克隆出下一次实例，而「撤销」只把原任务切回未完成，不会删除已克隆的实例 → 净效果是**凭空多出一个未完成任务**。重复任务是已上线能力，撤销又是本特性新引入的显式承诺，属逻辑错误而非极端边界。
2. **级联/竞态不涉及本特性**：无新增写路径，纯展示。
3. **`visibleCount` 恒等于 `tree.length`**：`splitCompleted` 是对顶层节点做完全划分，`active.length + completed.length === tree.length`，三元表达式右侧为死代码（见 🟢1）。不影响正确性。
4. **Today/Upcoming 无已完成入口**：这两类视图的 `filterTasks` 本就排除已完成，完成最后一个任务会直接消失（附撤销 Toast）。与旧行为一致，但「看不到自己刚做完什么」是新分区引入后的体验落差，见 🟡3。
5. **localStorage 读取时机**：`showCompleted` 在 `useState` 初始化时读 localStorage（`TaskList.tsx:39-41`），WebView 首帧前无 SSR 问题；隐私模式下 localStorage 抛异常的可能性极低（仓库 theme/proxy 均直接读），与既有惯例一致。

### 2. 安全性 — 无问题

无新端点、无鉴权面变化；任务标题经 React 文本节点转义后进入 Toast，无注入；`data-testid`/`data-task-title` 沿用，无信息泄露。

### 3. 性能 — 无问题

`dueBucket`/`splitCompleted` 各 O(n)、`groupByDue` O(n)，均在一次 `useMemo` 内；`renderNode` 每次渲染重建函数对象属正常量级。子任务引导线为纯 CSS 伪元素/绝对定位 span，无额外 DOM 复杂度。

### 4. 可维护性 — 良好，2 个 🟢

- 派生逻辑集中在 `filters.ts`，组件层无重复桶计算；`SHOW_COMPLETED_KEY` 具名常量。
- 🟢2：缩进几何散落两处（`TaskRow.tsx` 的 `left-11` / `ml-9` 与 `TaskList.tsx` 的 `left-6`），若后续调整缩进宽度需两处同步，建议抽成共享的 indent 常量或注释互指。
- 🟢3：`SHOW_COMPLETED_KEY` 直接读写 localStorage，与 `lib/proxySettings.ts` / `lib/updateVersion.ts` 的「pref 收敛到 lib」既有模式不完全一致；当前只一个 key，可接受。

### 5. 可读性 — 良好

注释解释了「为什么」：分组在树之上操作、搜索退化为平铺、重复任务不提供撤销的理由（`store.ts:414-430`）。`renderNode` 拆分后模板比原先的嵌套 `map` 更易读。

### 6. 测试覆盖 — 良好，2 个缺口

- 已覆盖：`filters.test.ts` +8（`dueBucket` 全桶 / `groupByDue` 顺序与空桶 / today 子集 / 父决定子 / `splitCompleted` 带走子树）；`task-list.test.tsx` 7 例（分组标题与数量、today 子集、已完成默认折叠与展开、偏好写入、搜索平铺、回收站平铺、空态）；`task-row.test.tsx` 改为断言即时 `toggleTaskWithUndo` 且不再 `requestConfirm`，并加 `showDivider`/子任务类名断言；e2e 4 条通过。
- 🟡1：`toggleTaskWithUndo` **无单元测试**，其「撤销」回调与（修复后的）重复任务分支完全未被自动化覆盖；store 无测试基建，可考虑对纯决策抽函数或在 e2e 断言「撤销」Toast 出现，顺带覆盖 `Toast.Provider` 接线。
- 🟡2：`task-list.test.tsx` mock 掉了 `TaskRow`，因此**子任务引导线/肘线的渲染**无组件级断言（仅靠 e2e 间接覆盖整体不报错）。

### 7. 最佳实践 — 良好

HeroUI v3 复合 API、`onPress`、Tailwind `dark:` 变体、`data-testid` 完整、UI 字符串全中文、无 `/api` 前缀改动、未触碰三态 `deserialize_set_field` 与同步层。`aria-expanded` 用于折叠按钮、装饰线 `aria-hidden`。

---

## 🔴 严重问题（必须修复）

1. **撤销完成重复任务会留下物化出的下一次实例，凭空多出一个未完成任务**
   - 位置：`apps/web/src/state/store.ts:414`（`toggleTaskWithUndo`）→ `store.ts:399`（`toggleTask` 的 `materializeNextOccurrence`）
   - 描述：完成带 `recurrence` 的任务会克隆下一次实例（新 id）。点「撤销」只把原任务切回未完成，克隆实例仍在，用户得到两个未完成任务，且删除其中一个无法阻止同步传播。
   - 建议 / 已修复：在 `toggleTaskWithUndo` 中判断 `t.recurrence`，有重复规则时只显示无操作按钮的提示 Toast，不提供「撤销」（回滚副作用成本高且 `materializeNextOccurrence` 未返回新实例 id）。若产品要求重复任务也能撤销，则需让 `materializeNextOccurrence` 返回新实例 id（及其子任务）并在撤销时一并删除。

## 🟡 一般问题（建议修复）

1. **`toggleTaskWithUndo` 缺少自动化测试，撤销路径与 Toast 接线的回归风险裸奔**
   - 位置：`apps/web/src/state/store.ts:414`
   - 描述：新增的 store 动作、`actionProps.onPress` 回调、以及「重复任务不提供撤销」的修复均无测试；`App.tsx` 新挂的 `Toast.Provider` 也无任何断言，一旦 HeroUI 队列/Provider 行为变化将无人发现。
   - 建议：把「是否提供撤销」抽成纯函数做 vitest；或在 e2e 勾选后断言「撤销」按钮出现、点击后任务回到未完成分区。

2. **`TaskRow` 被 mock，子任务引导线渲染无组件级测试**
   - 位置：`apps/web/tests/task-list.test.tsx`（`vi.mock("../src/components/TaskRow")`）
   - 描述：分组/折叠逻辑覆盖充分，但引导线与肘线的结构断言缺失。
   - 建议：补一条不 mock `TaskRow` 的用例，断言 `isSubtask` 行存在且父节点容器含引导线元素（可用 `aria-hidden` span 或加 `data-testid`）。

3. **Today/Upcoming 完成即时消失且无已完成分区，缺少「刚做完什么」的反馈**
   - 位置：`apps/web/src/lib/filters.ts:44-55`（这两类视图排除已完成）→ `TaskList` 分区仅在 `all`/项目视图出现
   - 描述：用户在此类视图完成最后一个任务后列表清空，仅剩会 5s 消失的 Toast，无法回看。竞品在 Today 也提供已完成折叠或计数。
   - 建议：产品决策项——可让 Today/Upcoming 的 `filterTasks` 保留今日已完成后放入折叠分区，或至少在空态显示「今天已完成 N 项」。

4. **文档未随行为更新（README 的列表/视图说明）**
   - 位置：`README.md`、`docs/CODE_TOUR.md`（`components/` 行描述「TaskRow 单行，子任务缩进/进度/折叠」）
   - 描述：列表新增分组与已完成分区属结构性行为，CODE_TOUR 的组件职责描述已略滞后。
   - 建议：CODE_TOUR 的 `TaskList`/`TaskRow` 行各补半句（时间分组、已完成折叠、子任务引导线）；不改也不影响功能。

## 🟢 优化建议（可选）

1. `apps/web/src/components/TaskList.tsx:51` — `visibleCount` 恒等于 `tree.length`（`splitCompleted` 是完全划分），三元表达式可简化为 `tree.length`；`showGroups`（`:46`）与渲染分支条件重复，建议以单一来源派生，降低后续漂移风险。
2. `apps/web/src/components/TaskList.tsx:120-131` 与 `TaskRow.tsx:62,66` — 缩进几何常量（`left-6`/`left-11`/`ml-9`）分散两文件，建议抽共享常量或交叉注释。
3. `apps/web/src/components/TaskList.tsx:12,40,56` — 偏好读写可直接内联也可收敛到 `lib/`（如 `lib/uiPrefs.ts`），与 `proxySettings`/`updateVersion` 模式对齐。
4. `apps/web/src/components/TaskList.tsx` 分组标题 — 可加 `role="heading"`/`aria-level` 提升读屏语义；若追求长列表可读性，可评估分组标题吸顶（`sticky`）。

## 📝 总体评价

这是一次克制、边界清晰的展示层重构：把「分组」「完成态拆分」做成可单测的纯函数、把渲染差异收敛在 `TaskList`、并以行为级 e2e 锁住新交互，工程质量良好。唯一必须处理的是撤销与重复任务物化的语义冲突（🔴1，已在本次评审中修复）；建议随后补齐撤销路径的自动化测试（🟡1）与子任务引导线的组件级断言（🟡2）。Today/Upcoming 的已完成反馈（🟡3）属产品取舍，可放入下一迭代。

---

## 修复记录（评审后跟进）

- ✅ **🔴1 已处理**：`store.toggleTaskWithUndo` 对带 `recurrence` 的任务不再提供「撤销」按钮（仅提示 Toast），避免撤销后残留物化出的下一次实例造成重复任务。
- ⏸ **🟡1/🟡2/🟡3/🟡4 知悉暂缓**：撤销路径 store 测试与子任务引导线组件测试留待补；Today/Upcoming 已完成反馈为产品决策；CODE_TOUR 组件描述随下轮文档更新。
- **复验**：`pnpm lint` / `pnpm typecheck` / `pnpm test:web`（79 全绿）/ `pnpm build:web` / `pnpm test:e2e`（4 全绿）均已通过。
