# 代码评审：添加任务流程优化（回车后弹出详情表单）

- 日期：2026-09-13
- 分支：`feature/quick-add-detail-form`（未提交工作区）
- 范围：`apps/web`（store / TaskList / QuickAddModal / TaskDetail / e2e / vitest）+ 过程文档；不含 `AGENTS.md`（预存改动，非本特性）
- 提案 / 方案：`docs/features/20260913-quick-add-detail-form.md` / `docs/tasks/feat-quick-add-detail-form/plan.md`

## 结论：✅ 通过，可合并（无 🔴 严重问题）

- **🔴 严重问题：0**
- **🟡 建议修复：3**
- **🟢 可选优化：7**

需求 1/2/3 全部落实：输入行优先级下拉已移除；回车打开详情弹框（标题预填）；「关闭/保存」双按钮 + 保存校验（空标题 → 内联红色错误、聚焦标题框、不关闭不创建）。`NewTaskInput` → JSON patch 的映射已对照 `sync-core` 的 upsert 语义（`merge.rs` 的 `task_defaults`）逐字段核实，缺席字段落创建默认值，语义正确。Esc / 点遮罩经 react-aria `onOpenChange(false)` 走同一条放弃路径。已验证门禁全绿（lint / typecheck / vitest 42 / build:web / e2e 3）。

---

## ✅ 优点

- **patch 映射与内核语义严格对齐**（`apps/web/src/state/store.ts:327-335`）：沿用「有值才带 key」风格，与 `crates/sync-core/src/merge.rs` 的 upsert（创建 = 默认值落底 + patch）完全一致——`notes` 空串、`labels` 空数组、`priority 0`、`dueDate null` 均省略 key，落 `task_defaults`。`dueDate !== null`（而非 truthy）的判断正确处理了时间戳为 0 的边界。
- **`projectId` 双语义有文档化约定**（`store.ts:22-23`）：`undefined` = 跟随当前视图、`""` = 显式收集箱，与 `addTask` 内 `?? view` 回退实现吻合。
- **弹框生命周期设计正确**（`QuickAddModal.tsx:14-22`）：条件挂载 + `useState` 初始化器捕获 props，关闭即卸载，重开即重置；注释把「为什么草稿只需初始化一次」讲清楚了。`submit` 每次渲染重建，无陈旧闭包问题。
- **表单细节到位**：优先级分段按钮与「清除」按钮都显式 `type="button"`（`QuickAddModal.tsx:90,113`），不会误触发表单提交；保存按钮 `type="submit"`（react-aria Button 默认 `type="button"`，不透传会导致提交失效——已正确处理）。
- **UI 字符串全中文、data-testid 覆盖全部主交互元素**（`new-task-modal/title/priority/due/project/labels/notes/save/close/error`），与 `detail-*` 命名风格一致。
- **测试是真断言**：vitest 校验了 `addTask` 收到的完整入参对象（含标签解析）；e2e 三条创建流全部改为新交互，并新增「空标题校验」与「关闭 = 放弃」两个行为断言（`sync.spec.ts:49-60, 88-93`），离线流证明弹框保存走本地优先写入不受断网影响。

---

## 分维度评审

### 1. 正确性 — 无问题

- 逐字段核对 `NewTaskInput` → patch：`title` trim 后必带；`project_id` 仅非空带（`""` → 默认收集箱）；`priority` 0 不带（默认 0）；`notes` 空串不带（默认 `""`）；`labels` 空数组不带（默认 `[]`）；`due_date` 仅 `fromDateInput` 返回非 null 时带（`dates.ts:57-62`，本地时区当天零点，与 TaskDetail 同源）。全部与 `task_defaults` 吻合，不存在「undefined 序列化进 JSON」或「误清字段」路径。
- 保存为 fire-and-forget（`void actions.addTask(...)` 后立即 `onClose()`，`QuickAddModal.tsx:34-45`）：本地写入在 `mutate` 内先落 oplog，UI 经 `afterMutate → reload` 刷新，弹框先关不影响创建；与仓库既有 `void actions.addSubtask(...)` 模式一致。
- 双击「保存」不会重复创建：`onClose` 是离散事件，React 在事件末同步冲刷重渲染，第二次点击时弹框已卸载。
- e2e 的 `fill("")` 清空预填标题再校验的写法正确覆盖了「预填内容被清空」分支。

### 2. 安全性 — 无问题

纯前端 UI 改动，不触碰 `/auth`、`/sync` 路由、同步层与 JSON 契约三态反序列化；所有输入经 React 转义，无 `dangerouslySetInnerHTML`，无注入面。服务端对空 patch（`Patch::is_empty`）的拒绝逻辑未受影响（title 恒存在）。

### 3. 性能 — 无问题

弹框按需挂载，键入仅重渲染弹框自身；`visibleTree` 的 `useMemo` 依赖不变；字段数量级极小，无昂贵计算。无必要优化。

### 4. 可维护性 — 良好，1 个 🟢

- `PRIORITIES` / `Field` 从 `TaskDetail` 导出复用（`TaskDetail.tsx:9, 482-489`），方向合理、无循环依赖。
- 🟢 「当前视图 → 默认项目」的解析逻辑现在存在两份：`QuickAddModal.tsx:19`（初始化草稿用于展示）与 `store.ts:321`（`projectId` 缺省回退）。弹框需要预选值所以必须自己解析，可接受；若后续第三处出现，考虑收敛为 `lib` 里的一个纯函数。
- 🟢 `addTask` 的 `projectId ?? 跟随视图` 分支在重构后生产代码已无调用方（唯一调用方恒传 `projectId`），属预留 API 通用性，建议保留但知晓其当前未被生产路径覆盖。

### 5. 可读性 — 良好

- 文件头注释、placeholder（「添加任务，回车填写详情」）、组件 doc 注释同步更新，无过期描述残留。
- `pendingTitle: string | null` 命名即语义（非空 = 打开弹框，值为预填标题）；草稿状态结构与 `TaskDetail` 的 `Draft` 同构，读者可平移理解。

### 6. 测试覆盖 — 良好，2 个 🟡、1 个 🟢

已覆盖：标题预填、空标题校验（不创建/不关闭）、编辑后错误消失、保存完整入参 + `onClose`、关闭不创建（vitest）；三条创建流 + 校验 + 放弃（e2e）；离线保存（e2e 第三测）。

### 7. 最佳实践 — 良好，1 个 🟡

- 命中仓库惯例：HeroUI 复合 API（已对照 `@heroui/react@3.2.5` d.ts 核实 `Modal.Root/Backdrop(isDismissable 默认 true)/Container/Dialog/...` 用法）、Tailwind `dark:` 变体、`onPress` 而非 `onClick`、无 `/api` 前缀、不改 Rust。
- 🟢 优先级分段按钮与「清除」按钮无独立 `data-testid`（容器有）——与 `TaskDetail` 的 `detail-priority` 现状一致，暂不需改。

---

## 🔴 严重问题（必须修复）

无。

## 🟡 一般问题（建议修复）

1. **Esc / 点遮罩的「放弃创建」路径没有任何自动化测试覆盖**
   - 位置：`apps/web/e2e/sync.spec.ts:88-93`（仅覆盖「关闭」按钮）；`apps/web/tests/quick-add-modal.test.tsx`（未覆盖）
   - 描述：提案验收标准写明「点关闭 / Esc / 遮罩 → 不创建任务」，三者共享 `onOpenChange(false)` 路径，但只有按钮分支被测试锁定。若未来有人把 `Modal.Backdrop` 显式传 `isDismissable={false}` 或改掉 `onOpenChange` 实现，测试不会报警。
   - 建议：e2e 补 `new-task-title`（或 `page.keyboard`）`press("Escape")` + 断言行不存在；遮罩点击在 e2e 用 `position` 点击 Modal 外坐标实现。若 react-aria 在 jsdom 下成本过高，至少补 Esc 的 e2e 分支。

2. **校验错误未以可访问方式关联到标题输入框**
   - 位置：`apps/web/src/components/QuickAddModal.tsx:77-81`
   - 描述：错误 `<p>` 与输入框无程序化关联（无 `aria-invalid` / `aria-describedby`，也无 `role="alert"`），读屏用户保存失败时得不到「标题不能为空」的播报，只能感知到焦点移回。与 `AuthScreen.tsx:141` 的现状风格一致（仓库先例），但表单弹框是校验密集场景，值得比现状多做一步。
   - 建议：给 `<Input>` 传 `aria-invalid={!!error}` 与 `aria-describedby="new-task-error"`，错误 `<p>` 加 `id`（可顺带 `role="alert"`）。

3. **「所属项目」控件与 TaskDetail 不一致**
   - 位置：`apps/web/src/components/QuickAddModal.tsx:124-141`（原生 `<select>`）vs `TaskDetail.tsx:363-387`（HeroUI `Select` + Popover）
   - 描述：同一个字段在新建弹框与详情面板使用两种控件，视觉与交互（原生下拉 vs 自绘 Popover）不一致。plan.md 已记录这是有意选择（对齐重复规则的原生下拉），故不算缺陷，但建议列为后续统一项。
   - 建议：后续将弹框切到 HeroUI `Select`（或反向将 TaskDetail 收敛），同一字段全应用一种控件。

## 🟢 优化建议（可选）

1. `apps/web/tests/quick-add-modal.test.tsx:22-24` — `beforeEach` 未从 `vitest` 导入（其余 API 均显式导入），靠 `globals: true` 生效；补一个 import 保持风格统一。
2. `apps/web/tests/quick-add-modal.test.tsx:64-71` — 标签解析未覆盖全角逗号 `，` 分支（`QuickAddModal.tsx:40` 的 `/[,，]/`）；`dueDate` 用 `expect.any(Number)`，可改为 `new Date(2026, 8, 20).getTime()` 精确断言（同测试环境时区下确定）。
3. `apps/web/tests/quick-add-modal.test.tsx:6-16` — mock 的 `view` 固定为 smart 视图，「从项目视图打开时默认选中该项目」（`QuickAddModal.tsx:19`）未被单测覆盖；可加一例 `view: { kind: "project", id: "p1" }` 断言 `<select>` 选中值。
4. `apps/web/src/components/QuickAddModal.tsx:64-65` — `autoFocus` 与 `titleRef` 双通道聚焦：react-aria 弹框挂载时已自动聚焦首个可聚焦元素，`ref` 仅为校验失败后重聚焦所需。无行为问题，知道即可。
5. `TaskDetail.tsx` 的 `Field` / `PRIORITIES` 若出现第三个消费方，建议迁到独立表单原语模块（如 `components/form.tsx`），避免 TaskDetail 成为共享工具的宿主。
6. `apps/web/e2e/sync.spec.ts:2` —（预存问题，非本次改动引入）文件头注释仍写「双端实时同步（WS）」，与本仓库「拉取式、无 WebSocket」的架构描述不符，下次顺手修正。
7. `apps/web/src/components/QuickAddModal.tsx:15-22` — 草稿对象与 `TaskDetail` 的 `Draft` 高度同构，若两处字段继续增长可考虑共享类型/`draftFrom` 式工厂；当前规模下不必。

## 📝 总体评价

实现与提案/技术方案高度一致，patch 映射经与 `sync-core` upsert 语义逐字段核对无误，弹框生命周期与表单提交细节（`type="button"`/`type="submit"`、条件挂载、焦点管理）处理得干净，测试是行为级断言而非走过场。建议合并前处理 🟡1（Esc/遮罩路径补测，直接对应验收标准），🟡2/🟡3 可作为后续小改进。

---

## 修复记录（评审后跟进）

- ✅ **🟡1 已处理**：e2e 补「Esc = 放弃创建」分支（`sync.spec.ts:95-100`）。Esc 与点遮罩共享 react-aria `onOpenChange(false)` 同一条关闭管道，Esc 已锁定该路径；遮罩点击需依赖内部 `data-slot` 选择器定位，脆弱且不新增覆盖面，未加。
- ✅ **🟡2 已处理**：标题校验错误补齐无障碍关联——`<Input>` 传 `aria-invalid` 与 `aria-describedby="new-task-error-desc"`，错误 `<p>` 加对应 `id` 与 `role="alert"`（`QuickAddModal.tsx:63-89`）。
- ✅ **🟡3 已处理（评审后用户决定统一）**：「所属项目」弹框换用与 TaskDetail 完全相同的 HeroUI `Select` 复合 API（`selectedKey`/`onSelectionChange` + `Trigger/Value/Popover/ListBox`），同一字段全应用一种控件；顺带补上 🟢3 建议的「项目视图打开时默认选中当前项目」单测（mock store 状态改为可配置）。
- ✅ **🟢1 已处理**：`beforeEach` 补显式导入。
- **复验**：eslint / `tsc --noEmit` / vitest 43 通过 / e2e 3 通过（含新增 Esc 分支）。
