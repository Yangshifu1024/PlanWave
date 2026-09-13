# 代码评审：托盘与窗口拖拽（tray + start-dragging）

- 日期：2026-09-13
- 分支：`feature/tray-and-dragging`（未提交工作区）
- 范围：`apps/client`（capabilities/default.json、Cargo.toml、src/lib.rs，及随之再生的 gen/schemas/capabilities.json）
- 关联：`apps/web` 侧 4 处 `data-tauri-drag-region`（TaskList.tsx:81、Sidebar.tsx:51、TaskDetail.tsx:168、WindowControls.tsx:24）此前因缺权限全部失效，本次修复

## 结论

**通过**：🔴 0 项，🟡 3 项建议修复，🟢 5 项可选。本变更的全部高风险点（托盘左键单击只切换一次、右键菜单仍可弹出、Windows 关闭拦截不阻塞「退出」与更新重启、移动端 feature 失效性、能力授权范围）均已对照本地 vendored crate 源码（tray-icon 0.24.2 / tauri 2.11.5）逐条核实，未发现阻塞性缺陷。🟡 项可在合入前顺手处理，也可留待后续。

## ✅ 优点

- **托盘单击语义在两个平台都精确成立（源码级核实）**：tray-icon 0.24.2 在 Windows 上对 `WM_LBUTTONDOWN` 与 `WM_LBUTTONUP` **各发一次** `Click`（Down/Up 两个 state，`tray-icon/src/platform_impl/windows/mod.rs:409-449`）；macOS 上 `mouseDown:`/`mouseUp:` 同样各发一次（`macos/mod.rs:336-368`）。因此 `lib.rs:63-67` 的 `button_state: MouseButtonState::Up` 过滤不是可有可无的风格偏好，而是**承重墙**——它把每次物理单击收敛为恰好一次 `toggle_main_window`，两平台行为一致。
- **`show_menu_on_left_click(false)` 的两平台行为核实无误**：Windows 菜单弹出条件为 `(menu_on_right_click && WM_RBUTTONUP) || (menu_on_left_click && WM_LBUTTONUP)`（windows/mod.rs:492-495），关闭左键弹菜单后右键菜单保留；macOS 的 `on_tray_click` 按 `menu_on_left_click`/`menu_on_right_click` 两个 Cell 分流（macos/mod.rs:489-506），右键 `performClick` 弹菜单，左键仅高亮且 **Click 事件照常投递**（toggle 不受影响）。且 `show_menu_on_left_click` 是 tauri 2.11.5 中非弃用 API（`menu_on_left_click` 已标弃用并指向它，tray/mod.rs:307-320），用对了。
- **退出链路与关闭拦截不冲突（源码级核实）**：`AppHandle::exit(0)` 走 `RunEvent::ExitRequested` → `RunEvent::Exit`（tauri app.rs:573），**不派发逐窗口 `CloseRequested`**，`prevent_close` 拦不住它——托盘「退出」在 Windows 关闭被拦截的情况下依然真正退进程。同理 `restart()`（updater relaunch 的底层）主线程路径直接 `cleanup_before_exit()` + `process::restart`（app.rs:588-592），非主线程经 `restart_on_exit` 随 Exit 流出，均绕过 CloseRequested——**Windows 隐藏到托盘不会卡死自动更新的重启安装**。
- **cfg 卫生无死角**：tauri 的 tray 模块为 `#[cfg(all(desktop, feature = "tray-icon"))]`（tauri lib.rs:113-114），且可选依赖 `tray-icon` 仅声明于桌面 target——feature 在 Android/iOS 上确实惰性，与 Cargo.toml 注释一致。闭包内 `#[cfg]` 作用于 `if let` 语句是稳定的语句属性（非不稳定的表达式属性）；每个 target 下要么 if-let、要么 `let _ = (window, event)`（lib.rs:32-35）消费两个闭包参数，五个 target 均无 unused 告警。
- **能力授权范围最小化**：`core:window:allow-start-dragging` 挂在既有 `"windows": ["main"]` 的 default capability 内（capabilities/default.json:5,13），仅主窗口 WebView 可调用，且该权限只暴露「发起原生窗口拖动」一个动作，无文件/进程面。`gen/schemas/capabilities.json` 由构建再生且本就被纳管，需与源文件同 commit 提交（已同改）。
- **前端接线早已就位**：`WindowControls` 关闭按钮走 `win.close()`（WindowControls.tsx:50），经 IPC 触发可拦截的 `CloseRequested`（而非绕过拦截的 `destroy`），与 Windows 侧 `prevent_close + hide` 正确咬合；macOS 红绿灯原生关闭销毁窗口后，`get_webview_window("main")` 返回 None、经 `from_config` 按配置重建（lib.rs:95,100-111），配置含 `titleBarStyle: "Overlay"`/`hiddenTitle` 一并还原。
- **约定遵守良好**：模块头注释同步更新了新的关闭语义矩阵（Windows 隐藏到托盘 / macOS 原生关闭 / Linux 关闭即退出，无托盘）；UI 字符串硬编码中文（「退出」「缺少应用图标」）；窗口操作 `let _ =` 的发射后不管风格与 `update_apk.rs` 中 `app.emit` 用法一致；未触碰任何同步域逻辑，架构边界零违规。

## 🔴 严重问题（必须修复）

无。

## 🟡 一般问题（建议修复）

1. **Windows 最小化状态下点托盘是「隐藏」而非「还原」，需要点两次**
   - 位置：`apps/client/src/lib.rs:88`
   - 描述：`is_visible()` 底层是 Win32 `IsWindowVisible`，对**已最小化**窗口仍返回 true。于是：最小化 → 点托盘 → `hide()`（任务栏图标直接消失，用户看不出任何变化）→ 再点托盘 → 才 show+focus。第一次点击的体感是「没反应」。
   - 建议：toggle 判定加入最小化分支——`is_minimized()`（Rust 侧调用，不走 IPC，无需追加 capability）为真时执行 `unminimize()` + `show()` + `set_focus()`；只有「可见且未最小化」才 `hide()`。
2. **`rebuild_destroyed_window` 静默吞掉全部错误，macOS 重建失败时无任何诊断**
   - 位置：`apps/client/src/lib.rs:104-109`
   - 描述：`from_config(...).and_then(build).map(...)` 整链结果被 `let _ =` 丢弃。若重建失败（如竞态下 label 仍被占用、配置缺失），macOS 用户点托盘将毫无反应，且日志零输出，线上极难排查。发射后不管风格适合 `hide/show` 这类单点操作，但整条重建链是托盘存在的意义所在，不宜同待。
   - 建议：至少把 `Err(e)` 打到 stderr（壳 crate 目前无 tracing 依赖，`eprintln!` 前缀 `[planwave]` 即可，与 WindowControls.tsx:14 的 `console.error("[planwave] ...")` 约定对齐）。
3. **`windows.first()` 隐式耦合「main 是配置里第一个窗口」，且 label 靠 serde 默认值**
   - 位置：`apps/client/src/lib.rs:103`；`apps/client/tauri.conf.json:13-23`
   - 描述：`tauri.conf.json` 的窗口项未写显式 `label`（serde 默认 `"main"`），重建时取 `config.app.windows.first()`。当前仅一窗口所以正确；未来若新增第二窗口（如独立设置窗）或调整顺序，托盘将重建错窗口或永不命中。toggle 查找用字面量 `"main"`（lib.rs:86）而重建按数组序，两处标准还不一致。
   - 建议：改为按 label 查找——`config.app.windows.iter().find(|w| w.label == "main")`，与 `get_webview_window("main")` 对齐；可顺带给窗口项补上显式 `"label": "main"`。

## 🟢 优化建议（可选）

1. **冗余 cfg 表达式**：`lib.rs:113-116` 的 `#[cfg(all(any(windows, macos), not(macos)))]` 恒等于 `#[cfg(target_os = "windows")]`。逻辑正确但读起来要展开两层布尔代数，建议化简；或更进一步把 toggle 里 `None =>` 分支整体 cfg 成 macos-only，直接删掉空 stub。
2. **菜单 id 字符串双写**：`lib.rs:53` 创建时 `"quit"`、`lib.rs:73` 比对时 `"quit"`，各自字面量。建议提为 `const QUIT_ID: &str = "quit";` 防止漂移（改文案不改 id 时尤其容易踩）。
3. **`expect("缺少应用图标")`**（lib.rs:57）：bundle.icon 已配置，实际不可达，启动期 panic 可接受；若想更优雅可转成 setup 返回 `Err`。纯风格项。
4. **Windows 快速双击托盘会 toggle 两次**：双击序列里 `WM_LBUTTONDBLCLK` 映射为 `DoubleClick`，但其后的 `WM_LBUTTONUP` 仍发一次 `Click{Up}`，净效果为「隐藏又显示」（窗口回到前台）。无害且符合多数托盘应用体感，仅记录；若将来觉得吵可加去抖。
5. **可自动化的回归测试（后续）**：托盘/关闭交互依赖真实桌面环境（Windows 托盘气泡区、macOS 菜单栏与红绿灯），本次只能人工验证（见下）。但有三件事可以沉淀为测试：① 解析 `tauri.conf.json` 断言恰有一个窗口且 label 为 `main`（守护 🟡3 的隐式假设）；② 断言 capability JSON 含 `core:window:allow-start-dragging` 且 `"windows": ["main"]`（守护权限范围不回退）；③ 把 toggle 判定抽成纯函数 `should_show(visible, minimized)` 后可无显示环境单测。注意 CI 的 Rust 检查 `--exclude planwave`，此类测试目前只在本地/Windows 开发机跑，价值在于固化契约。

## 人工验证清单（本次无法自动化，需真机确认）

- Windows：X 关闭 → 窗口隐藏、任务栏消失、托盘在；托盘左键单击显隐切换且单次点击只切换一次；右键仅「退出」；「退出」后进程真正结束；最小化后点托盘（🟡1 现状：需两次）。
- macOS：红钮关闭 → 窗口销毁、App 留在 Dock；托盘左键 → 重建窗口并置顶（重建后页面经 IndexedDB 正常恢复）；右键仅「退出」；⌘Q 退出；托盘菜单符合菜单栏惯例（右键弹出）。
- Linux：行为与现状一致（原生关闭即退出，无托盘）。
- 移动端（Android/iOS）：构建不受 `tray-icon` feature 影响；窗口拖拽区在移动端无副作用（`isDesktopApp` 已按平台裁剪）。
- Windows 自动更新：下载完成后「重启安装」能正常退出并拉起新版（验证 restart 路径未被关闭拦截波及）。

## 📝 总体评价

小而正确的平台壳层变更：三处决策（拖拽权限、托盘平台范围、三平台关闭语义）都在代码里落地得干净、注释诚实，所有跨平台歧义点经 crate 源码核实无一处想当然。最值得优先处理的是 🟡1（最小化后托盘首击无体感）——它是用户实际会立刻碰到的路径；🟡2/🟡3 属于可观测性与未来演进防线，代价都是一两行。

---

## 修复记录（评审后跟进）

- ✅ **🟡1 已处理**：托盘点击增加最小化分支——`is_minimized()` 为真时先 `unminimize()` + `set_focus()`，Windows 上最小化窗口不再被误判为「可见 → 隐藏」。
- ✅ **🟡2 已处理**：macOS 重建窗口失败不再静默——`WebviewWindowBuilder` 链式错误改为 `eprintln!` 输出（客户端壳无日志框架，保持轻量）。
- ✅ **🟡3 已处理**：重建窗口按 `label == "main"` 查找配置，不再耦合 `windows` 数组顺序；`tauri.conf.json` 窗口配置显式声明 `"label": "main"`（与 capabilities 的 `windows: ["main"]` 对齐）。
- ⏸ **🟢 项知悉暂缓**：stub 的冗余 cfg 表达式（等价 `target_os = "windows"`，可读性无碍）、`"quit"` 字面量单点使用、图标 `expect`（图标缺失属打包期错误）、Windows 快速双击托盘切换两次（无害）、可自动化回归项留待测试基建补齐。
- **复验**：`cargo clippy -p planwave` / `cargo fmt --check` / `pnpm test:rust` 15 套 / vitest 61 / `pnpm build:web` / e2e 3 全绿。
