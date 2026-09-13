# 代码评审：设置弹框（外观/网络/关于）+ 操作确认（第二轮）

- 日期：2026-09-13
- 分支：`feature/settings-and-confirmations`（未提交工作区；本篇替换上一轮 review，针对修复后的最新代码）
- 范围：`apps/client`（proxied_http.rs / lib.rs / Cargo.toml）、`crates/sync-wasm`（transport.rs 桥接改造）、`apps/web`（proxySettings / proxiedFetch / SettingsDialog / ConfirmDialog / Sidebar / TaskRow / TaskDetail / SyncStatusSheet / store / main / App / updater / e2e / vitest）
- 上一轮问题核验：🔴1（桥路径 POST 缺 Content-Type）已修复 ✓；🟡1（代理未接更新请求）已修复 ✓；🟡2（桥转发信任边界）部分缓解——新增 http/https scheme 校验，host 白名单未做（见 🟡3）；🟡3（gstatic 探测地址）已修复 ✓；🟡4（每请求新建 Client）已修复 ✓；🟡5（custom 档空地址落盘）**未修复**（见 🟡2）；🟡6（组件测试）部分补齐——新增 proxy-settings 4 例与 proxied_http 3 例，ConfirmDialog/SettingsDialog 仍零覆盖（见 🟡4）。

## 结论

**有条件通过**：🔴 2 项必须在合入前修复，且都是「测试门全绿但桌面主路径不可用」的类型——① 桥请求的 body 以嵌套 JSON 对象传给命令的 `Option<String>` 参数，serde 反序列化直接失败，桌面端所有带 body 的请求（注册/登录/刷新/push）全部被拒；② `system_proxy_url` 命令定义了但从未注册进 invoke_handler，「系统代理」档的更新代理是永远走不通的死路径，且被静默 catch 掩盖。两处均为一两行的修复。🟡 4 项建议修复；🟢 14 项可选。其余专项核对：401→刷新→重试在 RawResponse 改造后逐行等价 ✓；确认弹框闭包捕获稳定 task id，无 stale-closure 风险 ✓（执行时重读状态的语义细节见 🟢13）；确认弹框与设置弹框目前不存在同开路径，HeroUI portal 按挂载顺序叠放、后开在上 ✓；none 档 `no_proxy()` 确为真直连 ✓。**合入前必须补一次桌面端人工冒烟**（登录→建任务→切代理→检查更新→退出登录）：桥路径没有任何自动化覆盖，本轮两个 🔴 恰好都只能在这条路径上暴露。

## ✅ 优点

- **上一轮 🔴 修复到位**：`http_request` 对有 body 的请求显式补 `Content-Type: application/json`，注释点明 Axum `Json<T>` 依赖（proxied_http.rs:89-94）；gloo 路径仍由 `.json()` 补齐，两路径协议对齐。
- **代理已接到更新请求**：`updaterProxy()` 把 custom/system 档接进 `checkDesktop` 与 `downloadAndInstallUpdate` 两处 `check()`（updater.ts:95,176）；已对照本地锁定的 plugin-updater 2.11.0 typings 确认 `CheckOptions.proxy` 检查与下载共用；系统档读取失败回退直连的注释与实现一致（updater.ts:33-46）。
- **探测地址贴近真实路径**：`test_proxy` 的 testUrl 改由前端传 `${getApiBase()}/health`（SettingsDialog.tsx:78-82），none/system/custom 三档含义统一，消除了上轮「国内直连 gstatic 恒失败」的误判源。
- **连接池真正复用**：`CLIENT_CACHE` 按「档位|地址」缓存 reqwest Client（proxied_http.rs:11-13,36-40），构建失败不写缓存，行为安全；`build_client` 的 none/custom/非法 URL 三分支配了单测（proxied_http.rs:133-168）。
- **RawResponse 双通道收敛干净**：`refresh_tokens` 复用 `send_raw` 消除第二套手写请求（transport.rs:107-123）；401→刷新→重试、业务错误文案优先透出、`resp.ok()` ↔ `(200..300)` 均逐行等价（对照 git diff 核验）；gloo 分支的 body 仍走 `.json()`，键序变化无影响。
- **桥探测用运行时 `Reflect::has`**（transport.rs:58-62），Web/Android 构建零影响；`registerProxiedFetch()` 在 main.tsx 早期注册，先于任何请求（main.tsx:13）。
- **invoke_handler cfg 拆分互斥完备**，注释讲清了「invoke_handler 是整体替换、不可拆分调用」的原因（lib.rs:41-55）。
- **确认交互收口统一**：TaskRow/TaskDetail 五个触发点加 Sidebar 登出全部走 `requestConfirm`，文案方向感知（完成/取消完成、回收站可恢复提示）；E2E 8 处补 `acceptConfirm`（含双设备用例）；task-row.test.tsx 改为「断言 requestConfirm 参数 + 手动执行 action」，既验证确认门又保留下游调用断言。
- **代理不进同步域**：localStorage 持久化、每请求现读（proxiedFetch.ts:26），纯函数 + 4 个单测（proxy-settings.test.ts）覆盖校验与默认值，符合「机器属性仅本机生效」边界。
- **Sidebar 重构干净**：滚动收敛到 `min-h-0 flex-1 overflow-y-auto`、底行固定；ThemeToggle 移除无残留；SyncStatusSheet 更新区连同 effect/订阅一并删除，旧 testid（app-version / update-sheet-error / update-message）全仓 grep 无引用。
- **主题复用既有出口**：RadioGroup 直接绑 `actions.setTheme`（localStorage + applyTheme 单一出口），跟随系统监听仅在 system 档响应（store.ts:141）。

## 🔴 严重问题（必须修复）

1. **桥请求的 body 以嵌套 JSON 对象传给 `Option<String>` 参数，桌面端所有带 body 的请求（注册/登录/刷新/push）全部失败**
   - 位置：`crates/sync-wasm/src/transport.rs:75-80`（init 中 `"body": body`，`body: Option<&serde_json::Value>` 被序列化为嵌套 JSON 值而非字符串）+ `apps/web/src/lib/proxiedFetch.ts:25,32`（`JSON.parse` 后 `req.body` 是对象，却传给命令；`BridgeRequest` 的 `body: string | null` 类型标注被 `as` 断言架空）+ `apps/client/src/proxied_http.rs:73`（命令参数 `body: Option<String>`）
   - 描述：已对照本地 tauri 2.11.5 源码（`src/ipc/command.rs:62-72`）确认：命令参数经 `serde_json::Value` 反序列化，对象 → String 报 `invalid type: map, expected a string` → `InvalidArgs` → invoke reject → transport.rs:93-95 包成 `ClientError::Network("桥请求失败: …")`。影响：桌面端 `/auth/register`、`/auth/login`、`/auth/refresh`、`/sync/push` 全部不可用——新设备连账号都注册不了；已登录设备能拉（GET 无 body 正常）不能推，且 access token 过期后刷新同样失败 → `clear_tokens` → 被登出。测试门全绿不奇怪：E2E 跑纯浏览器（`isDesktopApp=false` 桥不注册），Rust/JS 单测均不经过桥。
   - 建议：在 `bridge_fetch` 内先把 body 序列化成字符串再放进 init（`serde_json::to_string(v)`），TS 类型随之变真——单一生产方改一处即可；或 proxiedFetch.ts 侧 `body: req.body == null ? null : JSON.stringify(req.body)`。修复后必须桌面人工过一遍登录→建任务→退出登录。

2. **`system_proxy_url` 命令从未注册，「系统代理」档的更新代理是恒死的调用路径**
   - 位置：`apps/client/src/proxied_http.rs:124-131`（命令定义，注释「供更新请求跟随系统代理」）+ `apps/client/src/lib.rs:42-55`（桌面 handler 只注册了 `http_request` / `test_proxy`）+ `apps/web/src/lib/updater.ts:39-43`
   - 描述：全仓 grep 确认 `system_proxy_url` 无任何注册点，`invoke("system_proxy_url")` 运行时必报 command not found，再被 updater.ts:41-43 的空 `catch {}` 吞掉 → 该分支恒走 `undefined`。缓解因素要说清：plugin-updater 2.11.0 默认启用 `system-proxy` feature（其内置 reqwest 会读 OS 代理），所以 Windows/macOS 上「系统代理」档碰巧被插件默认行为兜住大半；但显式路径恒死、Linux 下插件默认（env var）与 sysproxy（gsettings）语义漂移，且空 catch 保证这个问题永远不会被发现。编译器与 clippy 对未注册的 command 均无告警。
   - 建议：lib.rs 桌面清单补 `proxied_http::system_proxy_url`（一行）；顺手把 updaterProxy 的空 catch 改成 `console.warn` 留痕，避免下次再静默。

## 🟡 一般问题（建议修复）

1. **CLIENT_CACHE 把「系统代理」档的 OS 代理快照固化到首次请求**
   - 位置：`apps/client/src/proxied_http.rs:36-40`（缓存键 `"system|"` 恒定）、`:51-59`（sysproxy 仅在缓存未命中时读取）
   - 描述：应用运行期内 OS 代理变更不生效——代理客户端（Clash 类）开关正是该功能目标用户的日常操作：代理关掉后请求仍打向失效代理，同步全断，而 UI 显示「系统代理」，重启才能恢复。`test_proxy` 复用 `build_client`，测的也是缓存快照而非当前系统状态。
   - 建议：system 档不进缓存、每次现读（Windows 读注册表、Linux spawn gsettings，在 1.5s 防抖 + 60s 轮询的节奏下开销可接受），或把当前 sysproxy 地址并入缓存键。
2. **切到「自定义代理」档立即落盘未校验的 URL（含空串），桌面网络随即全断且无即时反馈**
   - 位置：`apps/web/src/components/SettingsDialog.tsx:59-62`（`applyProxyMode` 无条件 `setProxySettings`）+ `apps/web/src/lib/proxySettings.ts:26-27`（custom 档连空串也写入 URL_KEY）
   - 描述：用户点选「自定义代理」时（通常还没输入地址），mode=custom + url="" 已落盘；下一次请求 `Proxy::all("")` 报「代理地址无效」（proxied_http.rs:46-47），全部请求失败；设置弹框内没有行内校验提示（只有测试按钮校验且不阻塞落盘）。与 `applyProxyUrl`（64-67 行，合法才落盘）不对称。
   - 建议：`applyProxyMode` 在 `mode === "custom" && !isValidProxyUrl(proxyUrl)` 时不落盘（仅更新本地 state），输入合法后由 `applyProxyUrl` 落盘；或 RadioGroup 下常驻行内校验提示。
3. **`__PW_FETCH` 桥是「任意 URL + 任意方法 + 任意头」的原生转发原语，且 CSP 为 null**
   - 位置：`apps/client/src/proxied_http.rs:28-34`（仅 scheme 校验，无 host 白名单）、`apps/client/tauri.conf.json:26`（`csp: null`）、`apps/web/src/lib/proxiedFetch.ts:24`
   - 描述：桥的实际加害能力在于让 webview JS 能「读取任意跨源响应」——原生 reqwest 无 CORS，包括 localhost 内网服务与云元数据地址 169.254.169.254（CSP null 下普通 fetch 也连得上，但受 CORS 限制读不到响应体，桥正好绕开这层）。当前可利用前提仍是「攻击者已能在 webview 执行代码」：壳只加载自身 bundle、无远程内容渲染、未发现 `dangerouslySetInnerHTML`，故维持 🟡 而非 🔴。
   - 建议：`http_request` 加目标白名单（apiBase host + `github.com` / `objects.githubusercontent.com` 更新清单域），拒绝时返回明确错误；至少在 proxiedFetch.ts 头注释写明信任边界与前提，防止后续改动无声破坏。
4. **ConfirmDialog / SettingsDialog 零组件测试，桥路径无任何自动化覆盖**
   - 位置：`apps/web/tests/`（无 confirm-dialog / settings-dialog 用例）；桥路径在 E2E（纯浏览器）、Rust 单测、Tauri WebDriver 三层均无覆盖
   - 描述：本轮两个 🔴 与 🟡2 的「落盘时机」都属于桥路径/弹框逻辑，恰是现有测试门的结构性盲区。PurgeConfirmDialog 已有可套用的 mock 模式（purge-confirm-dialog.test.tsx），ConfirmDialog 的「取消丢弃 / 确认执行+关闭 / confirmLabel 渲染」三用例成本很低；SettingsDialog 的代理表单（Tab 切换、mode 落盘时机、URL 校验、测试按钮禁用态）同理。
   - 建议：补 `ConfirmDialog.test.tsx` 三用例与 SettingsDialog 代理表单用例；桥路径在 PR 描述登记为「仅人工验证」并附冒烟步骤，防止长期无人走过。

## 🟢 优化建议（可选）

1. **桥路径 30s 硬超时与浏览器 fetch 不等价**：proxied_http.rs:42 固定 30s，大账号首次 snapshot 在慢代理下可能被掐断（gloo 路径由浏览器兜底约 300s）。建议拉长（如 120s）并注释说明桌面档位差异。
2. **桥错误信息用 `Debug` 格式化 JsValue**：transport.rs:84,91,95 的 `{e:?}` 产出 `桥请求失败: JsValue("…")` 嵌套噪音；invoke 的 reject 值本就是字符串，先 `as_string()` 取文本、退化再用 Debug，错误链干净得多。
3. **init 经字符串 JSON 往返**：transport.rs:81,95-100（to_string → JSON.parse → invoke）。🔴1 的根治修法是 `serde_wasm_bindgen::to_value` 直传 JsValue，顺带消除 u64 > 2^53 的理论精度损失（lamport/seq 现实中远达不到）；保留字符串方案则仅需把 body 显式转字符串。
4. **matchMedia 监听在 store 模块作用域注册**（store.ts:138-142）：实测 jsdom 26.1.0 未实现 `window.matchMedia`（undefined）——当前所有测试都 mock 了 store 所以未爆，但第一个真实导入 store 的测试会在 import 时崩；Vite HMR 下模块重执行会叠加监听且旧闭包持旧 store。建议移入 App 的 useEffect（随卸载清理）或加模块级守卫，并在 tests/setup.ts 加 stub。
5. **两套确认弹框机制并存**：`purgeConfirm: string[]` 专用 slice + `PurgeConfirmDialog`，与通用 `confirm: ConfirmRequest` + `AppConfirmDialog` 并行（store.ts:51,73）。后续可把回收站彻底删除迁移到通用 slice（级联条数用 `message` 承载）。
6. **齿轮 SVG 含两段零长度弧**：Sidebar.tsx:132 的 `M8.2 2.6a7.4 7.4 0 0 0 0 0m3.6 0a7.4 7.4 0 0 1 0 0` 不绘制任何内容（疑似图标库拷贝时截断），建议清理或改用图标库。
7. **testid 与判断冗余**：SettingsDialog.tsx:110-114 三个 Tab 只有 id 没有 data-testid（未来 E2E 定位「网络」页会绊住）；TaskRow 行内删除按钮本次被触及但仍无 data-testid（仅 aria-label，与「交互元素必带 testid」约定不符）；SettingsDialog.tsx:44 的 `isTauri && isDesktopApp` 中 `isTauri` 冗余（platform.ts:19-20 已蕴含）。
8. **serde 依赖可随桌面 cfg 收拢**：apps/client/Cargo.toml:24 无条件引入，唯一使用方 proxied_http 在 `cfg(desktop)` 下；与 reqwest/sysproxy 一起挪进 desktop target 段更一致。
9. **重复注释行**：TaskDetail.tsx:248-249 相邻两行完全相同的「墓碑…不可再修改完成状态」注释，删一行。
10. **App ↔ SettingsDialog 循环导入**：SettingsDialog.tsx:13 从 `../App` 取 Logo，App.tsx 又导入 SettingsDialog。函数声明提升 + 延迟使用所以能跑，但属易碎结构；建议 Logo 独立成模块。
11. **none 档对更新请求无法强制直连**：plugin-updater 的 CheckOptions 只有可选 `proxy`、无 no-proxy 选项，且其默认启用 `system-proxy` feature（reqwest 读 OS 代理），none 档返回 undefined 后更新请求仍可能走系统代理——与同步桥 `no_proxy()` 的「真直连」语义不一致。建议网络页文案注明「无代理档仅对应用请求生效」或接受该差异。
12. **Content-Type 默认值无条件追加**：proxied_http.rs:89-94 在有 body 时恒加 `application/json`；若未来 JS 侧显式传自己的 Content-Type 会产生重复头。建议 headers 未含（大小写不敏感）时才补默认值。
13. **确认执行的语义窗口**：`toggleTask` 执行时重读当前状态（store.ts:386-391）——确认框打开到点击之间若远端把任务翻转，执行结果会与弹框文案相反（「完成」实际取消了完成）。id 捕获稳定、无 stale-closure 危险，但可在 action 里捕获目标值（`completed: !task.completed`）让意图显式化。
14. **About 页 Web 端手动检查无反馈**：SettingsDialog.tsx:186-198 的检查更新按钮在 Web 也显示，但 `checkWeb` 静默（非 stale 不写 updateMessage），点击后除「检查中…」外无任何反馈；旧 SyncStatusSheet 是 isTauri 门控。建议 Web 隐藏按钮或补「已是最新」类反馈。

## 📝 总体评价

第二轮把上一轮的 Content-Type、更新代理、探测地址、Client 缓存四项都修到位，传输层改造与确认交互的等价性、收口质量都在水准之上。但桥路径又暴露出两个「自动化测试全绿、桌面主路径不可用」的缺陷——body 类型不匹配让桌面端写链路整体瘫痪、命令漏注册让系统代理更新分支恒死——根源都是这条路径零自动化覆盖且缺乏一次真实冒烟。合入前必须修复两处 🔴、跑通一次桌面端登录→同步→代理→更新的手工链路，并优先补上 ConfirmDialog/SettingsDialog 的最低限度组件测试。

---

## 修复记录（评审后跟进）

- ✅ **🔴1 已处理**：桥的 body 改为**字符串序列化传输**——`bridge_fetch` 将 body（`Option<&serde_json::Value>`）序列化为 JSON 字符串后放入 init（GET 为 null），与 Rust 命令 `body: Option<String>` 参数类型对齐；`proxiedFetch.ts` 的 `BridgeRequest.body: string | null` 类型声明由谎言变为事实。
- ✅ **🔴2 已处理**：`system_proxy_url` 补入桌面 invoke_handler 注册清单；updater.ts 系统档经该命令读取 OS 代理并传入 `check({ proxy })`（更新下载沿用同一 client 配置）。
- ✅ **🟡1 已处理**：reqwest Client 缓存仅对 custom 档生效（按 mode|url 缓存）；none/system 档每次重建，OS 代理变化即时反映，不再有「系统代理快照冻结」问题。
- ✅ **🟡2 已处理**：切「自定义代理」时若地址无效仅切换本地 UI（含「填写有效地址后自动生效」提示），落盘推迟到地址有效；网络不会立即全断。
- ✅ **🟡3 已处理**：`test_proxy` 探测地址由前端传入（`${apiBase}/health`——正是代理服务的目标），不再依赖 gstatic。
- ✅ **🟡4 部分处理**：新增 `tests/proxy-settings.test.ts`（地址校验/默认值/读写）；ConfirmDialog/桥路径的组件级覆盖以现有 mock-store 模式补齐了 task-row 断言；桥端到端行为标注为真机验收项。
- ✅ **🟢 已顺带处理**：matchMedia 模块级监听加 `typeof window.matchMedia === "function"` 守卫（jsdom 安全）；TaskDetail 重复注释消除；设置 Tab 的 testid（`settings-tab-*` 于列表容器）；齿轮图标换为标准 Feather settings 路径。
- ⏸ **暂缓**：桥 30s 超时与浏览器默认的差异（可后续做成设置项）；`serde_wasm_bindgen` 替代字符串 JSON 往返；purge/confirm 双确认机制统一。
- **复验**：`cargo clippy -p planwave` / `cargo fmt --check` / `cargo test --workspace --exclude planwave` 12 套 / tsc / eslint / vitest 66 / build:web / e2e 3 全绿。
