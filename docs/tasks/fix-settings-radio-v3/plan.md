# 修复：设置弹框外观/网络选项不可点击、无选中态

- 日期：2026-09-13
- 分支：`fix/settings-radio-v3`
- 现象报告：设置弹框中「外观」「网络」两个 Tab 下的选项呈纯文本样式，无法点击，且看不到当前选中项（截图所示）。

## 根因

HeroUI v3 将 `Radio` 改为复合组件（与 Checkbox/Switch 同构），而 `SettingsDialog.tsx` 中两处 `RadioGroup`（外观-主题、网络-代理模式）仍是 v2 写法——把标签文字直接作为 `<Radio>` 的 children：

- v3 中 `<Radio>` 本体是 react-aria 的 `RadioField` 容器，不渲染任何可交互元素；
- 可点击区域是 `<Radio.Content>`（内部渲染 `RadioButton`）；
- 圆圈视觉与选中态由 `<Radio.Control><Radio.Indicator /></Radio.Control>` 提供——编译后 CSS（`@heroui/styles`）中圆点由 `.radio__indicator:empty:before` 伪元素生成，缺这两个元素就没有圆点。

因此渲染结果是三行纯文本：没有可点击区域（点不动）、没有 Indicator（看不到选中态），与截图现象完全吻合。主题与代理两个 RadioGroup 同时中招。受控逻辑（`value`/`onChange` → `actions.setTheme` / `applyProxyMode`）本身正确，无需改动。

交叉印证：项目内 `TaskRow.tsx` / `TaskDetail.tsx` 的 `Checkbox` 均已使用 v3 复合写法（Content/Control/Indicator），唯独 SettingsDialog 的 Radio 漏改。

## 修复方案

单文件改动：`apps/web/src/components/SettingsDialog.tsx`

1. 两处 RadioGroup 增加 `orientation="horizontal"`（用户要求横向排列；`@heroui/styles` 原生支持 `.radio-group[data-orientation=horizontal]` 布局）；
2. Radio 渲染改为 v3 复合写法，仅保留标题文字（无附加说明）：

```tsx
<Radio key={o.value} value={o.value}>
  <Radio.Content>
    <Radio.Control>
      <Radio.Indicator />
    </Radio.Control>
    {o.label}
  </Radio.Content>
</Radio>
```

3. 顺带为每个选项 Content 补 `data-testid="theme-option-*"` / `proxy-mode-option-*`，便于后续 E2E 定位。

既有交互确认无需改动：「自定义代理」档的代理地址输入框、「测试连接」按钮由 `proxyMode === "custom"` 条件块渲染（SettingsDialog.tsx:148 起），选项可点击后该交互自然恢复。

## 追加改动：设置弹框 Tabs 改为竖向（同分支，2026-09-13）

用户后续要求：设置中的 Tab 改为竖向。HeroUI v3 Tabs 原生支持 `orientation="vertical"`（编译后 CSS：`.tabs[data-orientation=vertical]{flex-direction:row}`，Tab 列表竖排在左、内容区在右；`.tabs__list[data-orientation=vertical]` 定义竖排 tab 样式），单属性改动。

- 改动：`SettingsDialog.tsx` 的 `<Tabs>` 增加 `orientation="vertical"`（附注释说明布局语义）。
- 验证：typecheck + eslint 通过；冒烟脚本补充「关于 ⇄ 外观」Tab 切换用例后全绿（data-selected 转移、html.dark 翻转不受影响），截图确认 Tab 列表纵向排列在左侧。

## 返工：样式不达标（同分支，2026-09-13）

用户反馈三点：①Tab 与内容无区隔；②代理三档横排时文字换行；③Radio 样式应对照官方 Delivery & Payment 示例。

- ② 根因：上一轮加的 `orientation="horizontal"` 在 Modal 宽度内对长文案（如「无代理（直连）」）触发 flex-wrap。对策：移除该属性，回归 HeroUI 默认竖排（官方文档中 RadioGroup 默认即 vertical，也正好与示例一致）。
- ③ 对策：按官方示例给 `.radio` 加卡片工具类：`rounded-lg border p-3` + hover 背景 + `data-[selected=true]` 蓝色边框/底色（浅深两套），RadioGroup 加 `gap-2`。
- ① 对策：改用官方复合 API `Tabs.ListContainer` 包裹 `Tabs.List`（自带底色圆角容器形成区隔），三个 Panel 补 `p-3` 内边距。
- 验证：typecheck + eslint 通过；冒烟脚本全绿（另补「网络 Tab 点自定义代理出现输入框」用例，纯 Web 端自动跳过，留桌面端确认），截图确认卡片式竖排、选中高亮与 Tab/内容区隔均符合预期。

## 返工 2：Tab 切换弹框高度跳动（同分支，2026-09-13）

用户反馈：三个 Tab 内容高度不一致，切换过程中弹框严重跳动。

- 根因：react-aria Tabs 仅渲染当前选中 Panel，三个面板内容高度不同（外观 ≈178px、网络 ≈232px、关于 ≈150px），弹框高度随面板变化；`placement="center"` 下垂直居中重算进一步放大视觉跳动。
- 对策：三个 Panel 统一加 `min-h-60`（240px，覆盖常规最高态「网络」），高度由常量而非内容决定；「自定义代理」展开属用户主动操作，允许自然增高。
- 验证：typecheck + eslint 通过；冒烟脚本新增三 Tab 弹框高度测量（外观/关于均 386px 一致，Web 端无网络 Tab 按预期跳过），截图确认 Tab 列表容器随内容拉伸、底部对齐、切换不再跳动。

## 返工 3：Tab 改横向 + 修复选中高亮（同分支，2026-09-13）

用户反馈：Tab 改回横向；选中 Tab 缺少高亮背景。

- 根因：HeroUI v3 的选中高亮由独立的 `Tabs.Indicator` 组件（SelectionIndicator）负责，需内嵌在每个 `Tabs.Tab` 内，此前从未渲染过该组件，因此选中只有文字变色。
- 对策：移除 `orientation="vertical"`（回归默认横向）；三个 Tab 内嵌 `<Tabs.Indicator />`（官方文档标准结构：Tab > [Indicator, 文字]）。
- 验证：typecheck + eslint 通过；冒烟新增断言——选中 Tab 内 `[data-slot="tabs-indicator"]` 必须可见（三个 Tab 轮流校验均通过），弹框高度依旧一致（外观/关于均 434px），截图确认横向 Tab + 高亮指示器效果。

## 返工 4：切换 Tab 时头部滚动条闪现（同分支，2026-09-13）

用户反馈：从外观切到网络 Tab 时，Tab 头部右侧闪现一个滚动条后瞬间消失。

### 第一轮修复（无效）

- 错误假设：`.modal__dialog` 宽度由内容驱动，切换瞬间弹框宽度变化导致 Tab 列表容器被压缩出现溢出。
- 已做：`Modal.Dialog` 加 `max-w-md min-w-96` 固定宽度；稳态冒烟断言宽度恒定 + 无溢出，全部通过——但用户反馈 bug 照旧，说明稳态测量未覆盖切换瞬间的帧。

### 帧级探针复现与真正根因

- 新增帧级采样探针（rAF 逐帧检查各容器 scrollWidth/clientWidth）：Web 环境 101 帧内捕获 0 次溢出——**Tab 列表容器从未溢出，滚动条不来自它**。
- 溯源：`styles.css` 的 `* { scrollbar-width: thin }` 通配选择器与 HeroUI ScrollShadow 的隐藏机制（`.scroll-shadow--hide-scrollbar { scrollbar-width: none }`，同为类选择器）在打包产物中的胜出顺序不稳定；通配规则胜出时滚动条恢复可见。桌面端（Tauri WebView2）非 overlay 滚动条会占布局空间、更粗更明显，故桌面表现远强于 Web 自动化环境——这正是「改动无效」而自动化全绿的原因。

### 有效修复

- `apps/web/src/styles.css`：在通配细滚动条规则后显式补 `.scroll-shadow--hide-scrollbar { scrollbar-width: none; scrollbar-color: auto; }`，保证 ScrollShadow 的隐藏规则在任何打包顺序下都生效。
- 验证：eslint 通过；帧级探针 101 帧零溢出；`getComputedStyle` 确认 scroller 的 scrollbar-width 为 none（覆盖生效）。
- 残留风险：滚动条闪现是桌面 WebView 特有表现，最终需桌面人工确认；但该修复使 ScrollShadow 的隐藏语义恢复可靠，且不影响其他容器的细滚动条。

### 教训

- 修 bug 前先让 bug 在自动化环境复现；复现不出时的「验证通过」只是没有检验到问题机制。

## 返工 5：单选卡片只有圆点区域可点，点整行无效（同分支，2026-09-13）

用户反馈：单选框只能点击圆点切换，点击卡片其他区域无效。

- 复现：点击位置探针 + 几何测量——卡片（Radio 根容器）395×48px，可点标签（Radio.Content，即 RadioButton）仅 58×21px，卡片大部分区域不在任何可点元素内。此前冒烟「全绿」是假象：Playwright 默认点元素中心，而 testid 挂在 Content 上恰好落在文字上；用户点的是卡片空白区。
- 根因：卡片样式（rounded/border/p-3/选中高亮）挂在 `<Radio>` 根容器上，而根容器只是 react-aria 的 RadioField 包装，**不是可点元素**；可点的只有内部的 Radio.Content，导致视觉卡片与可点区错位。
- 对策：卡片样式从 `<Radio>` 根移到 `<Radio.Content>` 上并加 `w-full` 铺满整卡——圆角/边框/内边距/选中高亮全部随可点区走，点卡片任意位置都切换。
- 验证：探针确认三个点击位置全部切换成功（圆点区域 ✓ / 卡片右上空白 ✓ / 文字 ✓），几何断言 `labelFillsCard: true`（395×48 与卡片完全重合）；完整冒烟回归全绿（选中态/高亮/高度 434px/宽度 448px 均未回退）；截图确认视觉不变。

## 风险与回滚

- 纯 UI 改动（SettingsDialog.tsx / styles.css），不触及同步核心/数据层；
- 回滚方式：还原对应文件；styles.css 的 ScrollShadow 覆盖规则需与通配细滚动条规则一起回滚。

## 验证记录

- [x] `pnpm typecheck` 通过（tsc --noEmit，2026-09-13）
- [x] `pnpm lint` 通过（clippy -D warnings + eslint）
- [x] `pnpm test:web` 通过（10 个测试文件 / 66 用例全绿；QuickAddModal 的 PressResponder stderr 警告为既有问题，与本次无关）
- [x] 人工冒烟（Web，自动化 Playwright）：真实服务端 + vite dev 下打开设置弹框，三个主题选项均可点击（点击后 `data-selected` 正确转移），`html.dark` 随浅色/深色切换正确翻转；选项横向排列、圆点指示器可见、仅标题无附加说明
- [ ] 桌面端（Tauri）快速过一眼：网络 Tab 点「自定义代理」后应出现代理地址输入框与「测试连接」按钮（该条件块与主题选择共用同一修复后的 Radio 机制，代码路径已确认，建议桌面人工确认一次）
