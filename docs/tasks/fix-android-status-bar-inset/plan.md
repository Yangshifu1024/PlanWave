# 修复：Android 顶部内容与系统状态栏重叠

- 日期：2026-09-16
- 分支：`fix/android-status-bar-inset`
- 现象报告：Android 真机上 Web 界面顶部被系统状态栏覆盖——汉堡按钮 / 搜索框 / 同步徽标 / 刷新按钮这一行压在状态栏之下，标题「今天」紧贴状态栏下沿；截图里同步指示出现两次，即工具栏与内容区发生了重叠。

## 根因

四层因素叠加，缺一不可：

1. **强制 edge-to-edge**：`gen/android/app/build.gradle.kts` 的 `targetSdk = 36`，Android 15+ 对 targetSdk ≥ 35 的应用强制 edge-to-edge（窗口铺满整屏、内容绘制到系统栏之下）；`MainActivity.kt` 又显式调用了 `enableEdgeToEdge()`，旧版本 Android 同样进入该状态。
2. **旧式留边机制失效**：内容被 AppCompat 包在 `action_bar_root`（`FitWindowsLinearLayout`，`android:fitsSystemWindows="true"`）内，该属性走的是旧式 `fitSystemWindows(Rect)` 通道；edge-to-edge 下 content insets 为 0，它既不再补边也不消费 insets，于是 WebView 顶到屏幕原点。
3. **壳层无兜底**：tauri 2.11.5 / wry 0.55.1 源码对 `insets` / `edge_to_edge` / `fitsSystemWindows` 全量 grep 零命中；`tauri.conf.json` 也没有任何 Android 窗口/insets 配置项。
4. **Web 层无处理**：`apps/web` 全仓无 `env(safe-area-inset-*)`；`index.html` 仅有 `viewport-fit=cover`（保留无害，但 Android WebView 对其支持不可靠，不作为主方案）。

补充时序约束：wry 通过 `activity.setContentView(webview)` 设置内容（`wry-0.55.1/src/android/main_pipe.rs:312-318`），且 WebView 是在主线程 looper 的回调里创建的，`onCreate` 返回时它还不存在 —— 所以修复不能挂在 WebView 上。

## 方案

改动落在 `gen/android/app/src/main/java/xyz/yangshifu/planwave/MainActivity.kt`（`app/src/main/java/` 下唯一被 git 跟踪的 Java 源码）：在 `super.onCreate(savedInstanceState)` 之后，对内容根 `android.R.id.content` 挂 inset 监听，把系统栏与刘海 inset 转成 padding。

```kotlin
val content = findViewById<View>(android.R.id.content)
val initialPadding =
  intArrayOf(content.paddingLeft, content.paddingTop, content.paddingRight, content.paddingBottom)
ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
  val bars =
    insets.getInsets(
      WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
    )
  view.setPadding(
    initialPadding[0] + bars.left,
    initialPadding[1] + bars.top,
    initialPadding[2] + bars.right,
    initialPadding[3] + bars.bottom
  )
  insets
}
```

关键取舍：

| 选择 | 理由 |
|---|---|
| 挂 `android.R.id.content` | 框架自带、必定存在（`super.onCreate` 后 PhoneWindow 已装好 decor）；无论 AppCompat 的 subDecor 是否已安装，它都是 WebView 的祖先。挂 `decorView` 会连带内缩窗口背景与覆盖层语义；挂 WebView 有时序问题。 |
| `systemBars() or displayCutout()` | 与 Google 官方 edge-to-edge 迁移写法一致；一次覆盖状态栏、导航栏与刘海/挖孔（横屏刘海在左右边缘）。`getInsets(mask)` 内部是逐边取 max（`Impl20` 调 `Insets.max`），不存在与 systemBars 重复相加的问题。 |
| 基于初始 padding 重算 | 幂等：旋转 / 多窗口 / 系统栏显隐 / 重复回调都不会累积。`configChanges` 已含 `orientation|screenSize|uiMode`，Activity 不重建，快照在整个生命周期内有效。 |
| 返回 `insets` 而非 `CONSUMED` | 官方示例返回 `CONSUMED`，但文档同时警告 API ≤ 29 上消费后兄弟视图收不到 insets；当前上游无任何 inset 消费者，不消费行为等价且规避该坑。 |
| 不处理 `ime()` | 键盘遮挡输入框是既有独立问题（manifest 未设 `windowSoftInputMode`），本任务不引入也不修复；将来若在同一回调里加 `ime()`，必须与 systemBars 取 max 而非相加。 |

顺带在 `AGENTS.md` 的 Known gotchas 补两条：Android 处于 edge-to-edge 且顶部 insets 由 `MainActivity.kt` 消费（`tauri android init` 只创建缺失文件，不会覆盖它；只有删除/重建 `gen/android` 才丢）；本地 `gradlew` 任务需要先跑一次 `tauri android dev|build` 生成被 gitignore 的 `<package>/generated/*.kt`，否则报 `Unresolved reference: TauriActivity`。

## 验证

已执行（静态）：

- 真实 Kotlin 编译：`./gradlew :app:compileArm64DebugKotlin`（本机 JDK 17 + Android SDK 36）—— **BUILD SUCCESSFUL**，产物 `app/build/tmp/kotlin-classes/arm64Debug/xyz/yangshifu/planwave/MainActivity.class`。首次编译曾失败，原因是两个与本改动无关的环境问题：① 应用 identifier 改名后遗留的旧包名目录 `app/src/main/java/com/planwave/todo/generated/`（未跟踪、被 gitignore，但仍在 source set 中参与编译，`Logger.kt` 引用了不存在的旧 `BuildConfig`）；② 当前包名的 `generated/*.kt` 尚未生成（首次跑 `tauri android dev|build` 后已生成）。删除①后编译通过。
- API 签名：`javap` 校验 `androidx.core:core:1.13.1` —— `ViewCompat.setOnApplyWindowInsetsListener(View, OnApplyWindowInsetsListener)`、`WindowInsetsCompat.getInsets(int) : androidx.core.graphics.Insets`、`WindowInsetsCompat$Type.systemBars()/displayCutout()`、`Insets.left/top/right/bottom` 公有 final 字段。
- 回归：`pnpm typecheck`（tsc --noEmit）与 `eslint` 均通过；未触碰 Rust/WASM 与服务端代码。

结论口径：**编译侧已验证完成**；仅剩真机目视确认（本机无模拟器调试会话）。

真机验证清单：

1. 竖屏：顶部工具栏与标题不再被状态栏遮挡，顶部留白恰为状态栏高度（无双份留白）；
2. 底部手势条不压住列表最后一行与回收站批量操作条；
3. 横屏 / 刘海屏：横屏时刘海侧不遮挡内容，旋转后 padding 不累积；
4. 深色模式切换后恢复正常；
5. 键盘弹出时输入框可见性（既有问题，仅记录）；
6. 一台 API ≤ 34 设备或模拟器，确认旧版本 Android 上行为一致。

回归面：未触碰 Web / WASM / 服务端代码，`pnpm typecheck`、`pnpm test:web`、`cargo test` 不受影响。

## 回滚

单文件还原：

```bash
git checkout -- apps/client/gen/android/app/src/main/java/xyz/yangshifu/planwave/MainActivity.kt
```

外加移除 `AGENTS.md` 的两条改动，即回到纯 edge-to-edge 状态（缺陷复现）。

## 未决 / 遗留

- 状态栏区域在加 padding 后显示的是主题 windowBackground 底色，可能与 Web 顶栏色（`#fafafa`）存在色带；如观感不理想，可考虑 Web 层 `env(safe-area-inset-*)` 方案（与 iOS 统一，但需验证 Android WebView 的 env() 取值）——两者**绝不能同时存在**。
- Android 侧无自动化门禁（`app/src/androidTest/` 不存在，PR CI 不编译 Kotlin）；本地已用 `gradlew :app:compileArm64DebugKotlin` 补足编译验证，视觉验证仍需人工真机确认。
