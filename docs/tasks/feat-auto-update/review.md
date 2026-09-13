# 代码评审：应用自动更新（桌面 updater / Android APK / Web 刷新提示）

- 日期：2026-09-13
- 分支：`feature/auto-update`（未提交工作区）
- 范围：`apps/client`（tauri.conf / updater overlay / capabilities / Cargo.toml / lib.rs / update_apk.rs）、`apps/web`（updater.ts / UpdateDialog / WebUpdateBanner / store / SyncStatusSheet / App / vite.config / vite-env.d.ts / vitest / e2e）、`.github/workflows/release.yml`、`scripts/gen-latest-json.mjs`、`docs/AUTO_UPDATE.md`、`README.md`
- 方案：`docs/AUTO_UPDATE.md`

## 结论

**有条件通过**：🔴 1 项（桌面下载/安装无错误兜底，失败会把弹窗永久卡死在「下载中」）必须在合入前修复；🟡 6 项建议修复（其中「下载中可被 Esc 关闭并误记跳过」与文档承诺的 deb 引导未实现两项与 🔴 同属更新主链路，建议一并处理）。安全设计（签名强制、占位公钥即失效、CI 无签名不出清单）验证无误，Android JNI 各调用签名与 FileProvider 配置比对正确。

## ✅ 优点

- **安全上 fail-closed，无静默绕过**：`tauri.conf.json` 占位公钥非空，`check()` 解析失败即报错（被前端静默吞掉），更新链路完全失效而非降级为「不校验」；未配置 `dangerousInsecureTransportProtocol`，endpoint 固定 HTTPS GitHub；CI 未配置签名密钥时不套用 `tauri.updater.conf.json`（`createUpdaterArtifacts` 保持 false），产物无 .sig、release 不生成 latest.json，全链路一致。
- **CI 条件逻辑正确**：latest.json 仅在三桌面 job `updater == 'true'` 时生成；macOS 的 updater 产物额外以 `APPLE_CERTIFICATE` 为前提（未签名 app 的自动更新在 macOS 不可用，注释写明了动机）；三路构建分支互斥完备（签名+updater / 签名无 updater / 未签名）。
- **产物命名闭环**：逐项核对「整理产物」重命名（`PlanWave_<v>_x64-setup.exe(.sig)` / `_aarch64.app.tar.gz(.sig)` / `_amd64.AppImage(.sig)` / `_universal.apk`）与 `gen-latest-json.mjs` 的 URL 参数完全一致；universal 双 darwin 条目共用同一产物与签名是正确做法。
- **Android JNI 正确性核对通过**：`getPackageName` / `getUriForFile` / `setDataAndType` / `addFlags` / `startActivity` 各 descriptor 与 Android API 一致；异常处理依赖 jni 0.21 的约定（调用后 pending exception 自动转 `Err`）成立，逐调用 `map_err` 无遗漏；`JObject::from_raw` 不取得所有权、无 double-free 风险；`file_name()` 归一化后拼 cache 目录，堵住了前端传参的路径穿越；`FLAG_NEW_TASK` + `FLAG_GRANT_READ` 组合正确；`gen/android` 的 manifest 已声明 `androidx.core.content.FileProvider`，authority `${applicationId}.fileprovider` 与代码拼出的 `<package>.fileprovider` 匹配，`cache-path path="."` 覆盖 `getCacheDir()`（`app_cache_dir`）。
- **版本对齐**：`__APP_VERSION__` 构建期注入（vite `define` + `vite-env.d.ts` 类型声明）正确；web `package.json` 0.3.0 = workspace 0.3.0 = `/about` 的 `CARGO_PKG_VERSION`，`pnpm bump` 机制保证不再漂移；`/about` 返回体键名 `planwave-server` 与 `checkWeb` 解析一致。
- **状态机主干清晰**：手动检查无视跳过（桌面/Android 均只对自动检查调用 `shouldPromptUpdate`）；`skipUpdate` 清 info + 回 idle；Android 下载失败回 idle + error 且弹窗按钮复位可重试；进度 `total === 0` 时 `updateProgress: null`，UI 端有 null 分支。
- **仓库约定遵守良好**：新交互元素全部带 `data-testid`（update-modal / update-skip / update-install / update-restart / update-progress-text / update-error / update-close / check-update / app-version / update-message / update-sheet-error / web-update-banner / web-update-reload）；UI 文案硬编码中文；HeroUI Modal 结构与既有 `PurgeConfirmDialog` 同构；更新状态属壳层 UI 状态，不经 oplog、不触碰同步域，无边界违规；`updater.ts` → `store` 单向引用的注释约定成立（store 未反向引入）。
- **纯函数抽取得当**：`isNewerVersion` / `shouldPromptUpdate` / `isWebStale` 可脱离 Tauri 环境单测，5 个用例覆盖了逐位比较、前导 v、pre-release 截断、跳过后同版本不再提示等关键语义。

## 🔴 严重问题（必须修复）

1. **`downloadAndInstallUpdate` 无任何错误兜底，失败即永久卡死更新弹窗**
   - 位置：`apps/web/src/lib/updater.ts:79-103`（对照 `downloadApkOnAndroid` 的 `try/catch`，updater.ts:127-138）
   - 描述：函数先 `setPartial({ updatePhase: "downloading" })` 再执行下载，但整体没有 try/catch；`UpdateDialog.startUpdate` 以 `void` 调用（UpdateDialog.tsx:23-26），rejection 变成 unhandled。失败路径真实存在：① 公钥占位符未替换时 `check()` 必然抛错（此时 phase 恰为 idle，点击无任何反馈，错误只在控制台）；② 下载中断网/超时；③ **deb 安装的 Linux**（见 🟡3）走到 updater 插件的非 AppImage 安装报错。任一情况 `updatePhase` 停在 `"downloading"`，弹窗两个按钮 `isDisabled={busy}` 永久禁用，用户只能杀进程。
   - 建议：与 Android 分支对齐——整体包 `try { … } catch (e) { setPartial({ updatePhase: "idle", updateError: String(e) }) }`，成功路径维持现状；`relaunchApp` 的调用点同理补 `.catch`。

## 🟡 一般问题（建议修复）

1. **「下载中」弹窗可被 Esc / 点击遮罩关闭，误触发 skipVersion 且吞掉重启提示**
   - 位置：`apps/web/src/components/UpdateDialog.tsx:30-33`
   - 描述：`onOpenChange` 关闭一律走 `skipUpdate()`，未按 phase 分流。下载中按 Esc：`skipUpdate` 把当前版本写入跳过表、`updateInfo` 清空、phase 回 idle，而后台下载仍在跑；完成回调把 phase 置 `"ready"` 时 `updateInfo` 已为 null，弹窗（`if (!info) return null`）不再出现——桌面端下载已暂存却永远等不到「重启安装」提示，且该版本被记为跳过，之后也不再自动提示。跳过按钮在 busy 时禁用，说明本意就是下载中不可跳过，Esc 绕过了它。
   - 建议：`onOpenChange` 中 `if (phase === "downloading" || phase === "checking") return;`（或在 Modal 上禁用下载期的 dismiss），并把 `skipUpdate` 限定在 idle/ready。
2. **Web 分支 `updatePhase` 停在 `"checking"` 永不复位**
   - 位置：`apps/web/src/lib/updater.ts:197-205`（`checkWeb` 全函数无 `updatePhase` 写入；`checkForUpdates` 只在 catch 里复位）
   - 描述：Web 检查成功路径（无论 stale 与否）都不写 idle，Web 端 `updatePhase` 从此卡在 `"checking"`。当前无实际消费者（更新区仅 `isTauri` 渲染、Web 无手动检查入口），但破坏了 idle→checking→idle 不变式，`checkForUpdates:59` 的重入守卫将吞掉未来 Web 端的任何后续检查。
   - 建议：`checkWeb` 末尾（或 `checkForUpdates` 的非 Tauri 分支统一）`setPartial({ updatePhase: "idle" })`。
3. **文档承诺的 deb 安装运行时引导未实现**
   - 位置：`docs/AUTO_UPDATE.md:54-55`「运行时通过 `APPIMAGE` 环境变量区分并引导手动下载」；全仓库 grep 无任何 `APPIMAGE` 引用（`apps/web/src`、`apps/client/src` 均无）
   - 描述：deb 用户会走 AppImage 更新流程：检查有新版 → 弹窗「立即更新」→ 插件安装阶段报错（叠加 🔴 即卡死；即便修了 🔴 也只是看到一条报错，得不到「去 Release 手动下载 deb」的引导）。文档与实现不一致。
   - 建议：在 `checkDesktop`/弹窗中检测 `APPIMAGE` 缺失（`isTauri` 桌面 Linux）时展示「请在 Release 页手动下载新 deb」文案，或改文档如实描述为「deb 用户更新会失败/仅 AppImage 支持」。倾向前者，同时顺带消解 🔴 的 ③ 场景。
4. **`WebUpdateBanner` 固定定位悬浮遮挡应用顶部交互区**
   - 位置：`apps/web/src/components/WebUpdateBanner.tsx:10`（`fixed inset-x-0 top-0 z-50`，高约 32px）；遮挡对象：`apps/web/src/components/TaskList.tsx:82-88`（移动端汉堡按钮，`pt-5` 起步）与 `apps/web/src/components/Sidebar.tsx:49-54`（Logo 行，`p-4 + pt-2`，顶部留白不足 32px）
   - 描述：横幅出现期间，视口顶部 32px 内的元素被 z-50 覆盖且不可点击（移动端 Web 的汉堡按钮首当其冲）。与 `WindowControls` 的潜在冲突已核实不存在（二者平台互斥：Windows 壳 vs 非 Tauri Web）。
   - 建议：改为 MainLayout 顶部文档流内渲染（`shrink-0` 一行，主内容自然下移），或显示横幅时给布局加 `padding-top`。
5. **Android 下载进度逐 chunk 发事件，IPC 洪泛**
   - 位置：`apps/client/src/update_apk.rs:61-64`
   - 描述：典型 30–50MB APK 按 8–64KB chunk 流式下载，每个 chunk 一次 `app.emit`（JSON 序列化 + JNI 跨越 + 前端 `setPartial` 触发 React 重渲染），数千次事件在低端机上会明显拖慢下载与 UI。桌面侧 `downloadAndInstallUpdate` 的 `Progress` → `setPartial`（updater.ts:93-97）同样逐块重渲染。
   - 建议：Rust 侧按「百分比变化 ≥1 或距上次 ≥100ms」节流，收尾必发一次；前端进度回调可同法节流。
6. **Android 更新链路缺少与桌面对等的完整性校验**
   - 位置：`scripts/gen-latest-json.mjs:65-69`（android 段仅 version/url/notes）、`apps/client/src/update_apk.rs:48-66`（下载即落盘，无校验）
   - 描述：桌面有 minisign 签名；Android 仅靠 HTTPS + 安装时系统同签名校验（可防外来签名 APK，防不了降级替换与 GitHub/CA 侧妥协）。既然 latest.json 已是自定义段，加完整性字段成本极低。
   - 建议：CI 生成 APK 的 sha256 写入 `android` 段，`download_impl` 下载完成后校验，不符即删除文件并报错（顺带兜住截断下载）。

## 🟢 优化建议（可选）

1. **CI notice 文案与实际门槛不符**：`release.yml:240-245` macOS 的 `updater` 输出以 `APPLE_CERTIFICATE` 为前提，但 `release.yml:519-525` 的 notice 只提示「未配置 TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)」。只配了签名密钥、未配 Apple 证书的用户会被误导。建议 notice 同时列出三个 job 各自的 `outputs.updater` 值。
2. **JNI 局部引用帧**：`update_apk.rs:87-159` 在持久 attached 线程上创建约 8 个 local ref（随调用累积直到 detach）。一次性操作无实害，但用 `env.with_local_frame(16, |_| { … })` 包住 install_impl 更符合 JNI 卫生习惯。
3. **`checkAndroid` 未校验 `android.url`**：updater.ts:181 只判 `version`；manifest 有 version 无 url 时弹窗照常出现，点击 `立即更新` 在 `downloadApkOnAndroid:114` 静默 return，无任何反馈。建议缺 url 时也走 `updateError` 或不展示弹窗。
4. **e2e 负向断言存在竞态**：`apps/web/e2e/sync.spec.ts:41-42` 的 `toHaveCount(0)` 默认 5s 超时，与 `AUTO_CHECK_DELAY_MS = 5_000` 的延迟检查几乎同时到期，可能横幅逻辑坏了也先断言通过。建议断言前等检查真正执行过（如固定 `waitForTimeout` 到 5s 之后，或暴露检查完成信号）再断言。
5. **FileProvider 范围过宽**：`gen/android/app/src/main/res/xml/file_paths.xml` 的 `cache-path path="."` 将整个 cache 目录暴露为可授读；`name="my_cache_images"` 也是历史遗留命名。建议收敛为 `path="apk/"` 并让 `download_impl` 落盘到 cache/apk 子目录。
6. **GitHub URL 三处硬编码**：`tauri.conf.json` endpoints、`updater.ts:11-12` `LATEST_MANIFEST_URL`、`release.yml:506` `BASE` 各自维护仓库名/地址，换组织或加镜像需改三处。至少在 `docs/AUTO_UPDATE.md` 里列明这三处的联动关系。
7. **签名密钥配对的健壮性**：release 各 job 只检测 `TAURI_SIGNING_PRIVATE_KEY` 是否非空；若密钥有口令而 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 未配，tauri build 会在签名步骤硬失败、整条 release 阻塞（fail-loud 可接受），`docs/AUTO_UPDATE.md` 可补一句「两个 secret 必须同时配置」。
8. **「跳过此版本」语义偏重**：Esc 随手关掉弹窗也会永久跳过该版本（直到更新版本出现）。可考虑区分「跳过」与「稍后提醒」，或至少在下次冷启动时给一次复现入口（同步详情页已有手动检查兜底，故仅提示）。

## 📝 总体评价

整体是一份安全意识在线、约定执行到位的特性实现：updater 链路 fail-closed、CI 无签名路径完全退化且各环节（产物、清单、notice）自洽，Android JNI 细节经逐项比对无发现运行期崩溃点。最需要优先收敛的是更新主链路的错误处理：`downloadAndInstallUpdate` 的裸奔（🔴）配合「下载中可被 dismiss」的洞（🟡1）和文档未兑现的 deb 引导（🟡3），会让第一批真实用户（公钥未配、Linux deb、断网）在同一处卡死或无反馈；修掉这一组并复位 Web 分支的 `updatePhase` 后即可合入。

---

## 修复记录（评审后跟进）

- ✅ **🔴1 已处理**：`downloadAndInstallUpdate` 全程 try/catch——`check()` 与 `downloadAndInstall` 任一失败都回置 `updatePhase: "idle"` 并写 `updateError`，弹框不再卡在「下载中」。
- ✅ **🟡1 已处理**：`UpdateDialog.onOpenChange` 按阶段守卫——仅 idle 态关闭才视为「跳过此版本」；下载中/待重启时 Esc 与点遮罩不再触发 skipUpdate、不再丢失更新入口。
- ✅ **🟡2 已处理**：`checkForUpdates` 的 Web 分支在 `checkWeb` 后回置 `updatePhase: "idle"`，状态机不变量恢复。
- ✅ **🟡3 已处理**：新增 Rust 命令 `is_appimage`（读 `APPIMAGE` 环境变量）；桌面「立即更新」先检测——非 AppImage（deb 等）时经 tauri-plugin-opener 打开 GitHub Release 页并提示手动下载，不再盲目走 updater。
- ✅ **🟡4 已处理**：`WebUpdateBanner` 从 `fixed top-0 z-50` 改为 `MainLayout` 顶部静态条（外层改 `flex-col`，内容区 `min-h-0 flex-1`），不再遮挡侧栏与汉堡菜单。
- ✅ **🟡5 已处理**：APK 下载进度事件按 256KiB 节流（并在完成时补发一次精确进度），避免数千次 IPC/重渲染。
- ✅ **🟡6 已处理**：Android APK 增加 sha256 完整性校验——CI 在「整理产物」时计算 APK sha256 传入 gen 脚本写入 `latest.json` 的 `android` 段；下载命令流式计算摘要，不一致即删除文件并报错。附带加固：`checkAndroid` 要求 `android.url` 必须为 https 直链。
- ⏸ **🟢 项知悉暂缓**：CI notice 措辞、JNI 局部引用帧清理、e2e 断言时序、FileProvider `cache-path path="."` 粒度（Tauri 模板默认）、GitHub URL 多处硬编码（已在 updater.ts 内收敛为常量，release.yml 由 `github.repository` 注入）、密钥/口令配对说明（docs 已含）。
- **复验**：`tsc --noEmit` / eslint / vitest 61 / `pnpm build:web` / e2e 3 / `cargo check+clippy -p planwave` 全绿。
