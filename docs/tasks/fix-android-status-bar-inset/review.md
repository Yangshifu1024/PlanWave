# 代码评审：Android 顶部内容与系统状态栏重叠修复

- 日期：2026-09-16
- 分支：`fix/android-status-bar-inset`（未提交工作区，基线 `main@bf8b786`）
- 范围：`apps/client/gen/android/app/src/main/java/xyz/yangshifu/planwave/MainActivity.kt`、`AGENTS.md`
- 方案：`docs/tasks/fix-android-status-bar-inset/plan.md`

## 结论

**有条件通过**：🔴 3 项。其中 2 项（文档事实错误、任务文档缺失）已在本次评审后当场闭环；第 3 项（真实 Android 构建 + 真机目视的验证闭环）经决策**显式接受为遗留项**，转交 release 流水线与真机验证（理由见下文「遗留项」）。Kotlin 逻辑本身无需返工。

## ✅ 优点

- **与官方推荐写法一致**：Google「Display content edge-to-edge in views」给出的正是 `insets.getInsets(systemBars() or displayCutout())` 转 padding，并明确要求用逻辑或合并两者；实现与之逐字对应。
- **不存在重复相加（字节码实证）**：`androidx.core:core:1.13.1` 中 `WindowInsetsCompat$Impl20.getInsets(int,boolean)` 对每个 type 结果调用 `Insets.max(...)`，API 30+ 直通平台 `WindowInsets.getInsets(int)` → `getInsets(mask)` 是逐边并集而非求和，systemBars 与 displayCutout 重叠不会双计。
- **不消费 insets 比官方示例更稳**：官方示例返回 `CONSUMED`，但同页警告 API ≤ 29 上消费后兄弟视图收不到 insets；当前上游无消费者，返回原值行为等价且规避该坑。
- **挂载点时序可靠**：`findViewById(android.R.id.content)` 在 `super.onCreate` 后必然非空（`PhoneWindow.findViewById` → `getDecorView()` → `installDecor()`）；AppCompat 的 subDecor 无论是否已安装，该 view 都是 WebView 的祖先，padding 都能生效。
- **无上游冲突**：wry `src/android/` 全目录 grep `WindowInsets|OnApplyWindowInsets|fitsSystemWindows|decorFitsSystemWindows` 零命中；`androidx.activity` 1.10.1 的 `EdgeToEdge*` 字节码中 `OnApplyWindowInsetsListener` 引用数为 0，`enableEdgeToEdge()` 不会抢占该 listener。
- **幂等写法正确**：基于 onCreate 快照重算，且 `AndroidManifest.xml` 的 `configChanges` 覆盖 `orientation|screenSize|uiMode`，Activity 不重建，快照全程有效。
- **性能**：仅在 insets 变化时回调一次 `setPadding`，O(1)，无热点。

## 🔴 严重问题

1. **`AGENTS.md` 关于 `tauri android init` 的表述与事实相反** —— 已修复
   - 原表述为「`tauri android init` may overwrite it」。经上游源码核实（`tauri-apps/tauri` `tauri-cli-v2.11.4` 的 `crates/tauri-cli/src/mobile/android/project.rs::generate_out_file`）：仅当文件名是 `BuildTask.kt` 时才 `truncate(true)` 无条件重写，其余文件走 `else if !path.exists()` 才创建 —— 即**已存在的 `MainActivity.kt` 不会被覆盖**，只有删除/重建 `gen/android` 才会丢。
   - 处置：改为准确表述，并补一条本地构建前置条件（需先跑 `tauri android dev|build` 生成被 gitignore 的 `<package>/generated/*.kt`，否则 `gradlew` 报 `Unresolved reference: TauriActivity`）。

2. **缺少验证闭环（构建 + 真机）** —— 显式接受的遗留项
   - 事实：`apps/client/gen/android/app/src/androidTest/` 不存在（`build.gradle.kts` 里的 espresso/junit 是模板遗留），`pnpm test:*` 全在 Rust/Web/E2E 侧，PR CI 不编译 Android Kotlin，唯一真实编译发生在 `.github/workflows/release.yml:402` 的 `tauri android build --apk`。本机 `gradlew :app:compileUniversalDebugKotlin` 已实际执行，但被既有环境问题阻断（见 plan.md「验证」），改由 CI 与真机兜底。
   - 已完成的替代验证：真实编译证明 `androidx.core` 在编译类路径（新增 import 无 unresolved）；`javap` 逐项校验所用 API 签名与 `Insets` 公有字段。
   - 「验证完成」的定义（供真机执行者对照）：① release 流水线 Android job 编译打包成功；② 真机上竖屏顶部工具栏不被状态栏压住且留白恰为状态栏高度；③ 横屏刘海侧不遮挡；④ API ≤ 34 设备无双份留白；⑤ 旋转 / 深色切换后正常。

3. **缺陷流程要求的任务文档缺失** —— 已修复
   - `AGENTS.md` 的缺陷流程（第 108-116 行）要求修复方案落 `docs/tasks/<fix-task-name>/plan.md`，既有 fix 任务均遵守；本次原缺。
   - 处置：补 `docs/tasks/fix-android-status-bar-inset/plan.md` 与本文档。

## 🟡 一般问题（建议，未阻塞）

1. 可考虑在注释里点明「有意偏离官方 `CONSUMED` 示例」，避免后续维护者「顺手改回去」。
2. `androidx.core` 是经 `appcompat` 传递引入的隐式依赖；若要更显式，可在 `app/build.gradle.kts` 声明（注意该文件是 tauri 模板生成物，改动需评估 `tauri android init` 的影响）。
3. 状态栏区域在加 padding 后显示主题 windowBackground 底色，可能与 Web 顶栏色（`#fafafa`）形成色带 —— 观感问题，非缺陷。
4. 若将来 Web 层引入 `env(safe-area-inset-*)`，必须同时移除本处原生 padding，两者**绝不能并存**。

## 遗留项

| 项 | 处置 |
|---|---|
| 真实 Android 构建 + 真机目视验证 | 交由 release 流水线与真机执行（用户决策：不做本机 ~10 分钟 NDK 构建） |
| 键盘遮挡输入框（edge-to-edge 下 `adjustResize` 不再收缩内容） | 既有问题，本改动不引入也不修复；如需处理应另开任务 |
| 状态栏色带观感 | 观察真机效果后再决定是否调整主题或改走 Web 层方案 |

## 更优解评估

- `WindowCompat.setDecorFitsSystemWindows(window, true)` 退出 edge-to-edge：**不可行**，targetSdk ≥ 35 下该 API 已被忽略，Android 15+ 强制 edge-to-edge。
- Web 层 `env(safe-area-inset-*)`：与 iOS 可共用一套实现、状态栏区域显示 Web 顶栏自身颜色；代价是需验证 Android WebView 对 `env()` 的支持、且改动面扩到六端共用的前端。取舍：本次保留原生 padding（平台语义更准、风险最小），Web 方案记为后续可选改进。
