# 代码审查报告：Android APK 签名修复

- 日期：2026-09-16
- 分支：`fix/android-apk-signing`（PR #12）
- 审查对象：`git diff main...HEAD`，即 `f624771` 及其后的审查加固改动
- 审查角度：正确性 / 安全性 / 性能 / 可维护性 / 可读性 / 测试覆盖 / 最佳实践

审查过程中发现并当场修复一项（详见「审查中已修复」）。

## 审查中已修复

1. **签名判定只认 v2/v3 会误杀构建**（`release.yml`「校验 APK 已签名」）。原实现仅 `grep -qa "APK Sig Block 42"`；若 AGP 因配置关闭 v2（如只开 v1）就会把正确签名的包判成未签名，直接阻断发版。改为「v1（`META-INF/*.RSA|DSA|EC`）或 v2/v3」取或。
2. **`mapfile` 的可移植性**：原用 `mapfile -t`，属 bash 4+ 语法，本机 macOS bash 3.2 无法 dry-run 该步骤。改用 `set -- <glob>` + `[ -f "$1" ]` + `$#` 计数，POSIX 兼容且行为等价。
3. 用 6 组 fixture（v1 签名 / v2 签名 / 无签名内容 / 文件名含 `unsigned` / 0 个产物 / 2 个产物）实跑校验脚本，全部符合预期；同步更新了 `docs/ANDROID_SIGNING.md` 与 `plan.md` 的措辞。

## ✅ 优点

- **根因定位完整**：把「未签名包能发出去」拆成 gradle 无 `signingConfigs`、CI 用了不存在的 `TAURI_ANDROID_KEYSTORE_*`、流水线无产物校验三层，每层都有可复现证据（`apksigner verify` 输出、CI 日志里的 `-unsigned.apk` 路径、`signingReport` 的 `Config: null` 对照）。
- **回归官方路径**：以 `keystore.properties` + `signingConfigs` 实现，正是 Tauri 官方文档的做法，去掉了自造变量，后续升级模板不会踩空。
- **fail-loud 闭环**：产物名校验 + 签名块校验 + 「整理产物」兜底，三条独立防线；任一环节拿到未签名包都会红。
- **密钥卫生**：keystore 只在 `$RUNNER_TEMP`，不进工作区；`keystore.properties` 落在两处 `.gitignore` 已覆盖的路径；上传的 artifact 只含 `*.apk`；Secret 经 `env` 注入而非内联进脚本体，不会被日志打印。
- **降级可控**：`keystore.properties` 缺失时 gradle 仍能完成配置（本地无密钥不阻塞），CI 跳过打包且 `latest.json` 的 `android` 段可省，前端 `updater.ts:206-214` 已判空，不会崩。
- **验证有据**：`signingReport` 的有/无 keystore 对照实验，比「跑一遍构建看看」更能证明签名配置真的挂上了 `release` variant。

## 🔴 严重问题（必须修复）

无。

## 🟡 一般问题（建议修复）

1. **密钥缺失时静默丢掉 Android 交付物**
   - 位置：`.github/workflows/release.yml:379-382`（「配置 Android 签名」的 `signed=false` 分支）
   - 描述：secrets 缺失或被误删时，job 成功、无 artifact、`latest.json` 无 `android` 段；Android 端「检查更新」会得到「已是最新版本」（`apps/web/src/lib/updater.ts:206-214`）。发版本是「预期交付五端」的场景，静默少一端属于本次要消灭的同一类问题（静默降级），`::notice::` 在 run 摘要里不够显眼。
   - 建议：至少把 `::notice::` 提升为 `::warning::`；更严格的做法是 tag 触发时直接 `exit 1`（失败信息里指明是 secrets 未配置），把「要不要出 Android 包」变成显式决策。
2. **`keystore.properties` 缺键时报错不可读**
   - 位置：`apps/client/gen/android/app/build.gradle.kts:42-45`
   - 描述：`keystoreProperties["keyAlias"] as String` 在缺键或拼错时会抛 `TypeCastException`/`NullPointerException`，堆栈里看不出是哪个键、哪个文件有问题。
   - 建议：读文件后先断言 `password` / `keyAlias` / `storeFile` 三者存在，缺失时抛带文件路径与键名的错误（`error("keystore.properties 缺少 $key: $keystorePropertiesFile")`）。
3. **文档硬编码 build-tools 版本**
   - 位置：`docs/ANDROID_SIGNING.md` §二
   - 描述：写死 `build-tools/36.0.0/apksigner`，而本机同时存在 35/36/36.1/37，升 SDK 后文档即失效。
   - 建议：改为 `APKSIGNER=$(ls -d "$HOME/Library/Android/sdk/build-tools/"*/ | sort -V | tail -1)apksigner`。
4. **`keyPassword` 与 `storePassword` 共用 `password`**
   - 位置：`apps/client/gen/android/app/build.gradle.kts:43,45`
   - 描述：沿用官方示例，二者同源；将来若需要独立的 key password（换 keystore 工具或合规要求）必须同时改 properties 契约与文档。
   - 建议：加一行注释说明这个约束（当前 `docs/ANDROID_SIGNING.md` 有说明，gradle 侧没有）。

## 🟢 优化建议（可选）

1. **文档重复了一步**：`pnpm build:android` 的 `beforeBuildCommand` 已是 `build:wasm && web build`（`apps/client/tauri.conf.json:9`），文档里的「`pnpm build:wasm` 首次或数据层改动时」容易让人以为必须手动先跑；建议注明「CLI 会自动执行」。
2. **`scripts/gen-latest-json.mjs` 无自动化测试**：它一旦生成坏清单会让三端桌面 updater 全挂。建议补一个纯 node 断言测试覆盖 4 种参数组合（无 apk / 有 apk / 只有 `--apk` / 只有 `--apk-sha256`），纳入 `pnpm test:web` 之外的轻量脚本或 CI。
3. **文档命令风格不一致**：`base64 ... | gh secret set NAME` 用了管道，另两条不带值会走交互输入；建议统一为 `gh secret set NAME -b <值>` 或全部走管道。
4. **可选的交叉验证**：ubuntu runner 自带 build-tools，可在校验步骤额外跑 `apksigner verify`，与签名块判定互为印证；当前无外部依赖的实现已足够，不必强求。

## 📝 总体评价

修复层次完整（gradle 配置 / CI 写入 / 产物校验 / 文档四件套齐备），把「未签名也能发出去」这条静默路径从三个方向堵死，且回归了 Tauri 官方签名方式；审查中发现的唯一功能性隐患（只认 v2 签名会误杀构建）已当场修复并实测。最需要优先处理的是 🟡1——密钥缺失时从 `notice` 升级为 `warning` 或直接失败，否则同类静默降级会以「少发一个端」的形态回归。

## 验证记录

- [x] `actionlint .github/workflows/release.yml` 无 error/warning；shellcheck 告警与改动前一致（5 条既有 SC2086/SC2012）
- [x] `python3 -c yaml.safe_load` 解析通过
- [x] 签名校验脚本 6 组 fixture 实跑：v1 ✓ / v2 ✓ / 无签名 ✗ / `-unsigned` 名 ✗ / 0 产物 ✗ / 2 产物 ✗
- [x] `node --check scripts/gen-latest-json.mjs` + 4 种参数组合实跑
- [x] `:app:signingReport`（打桩 CLI 生成物）对照：无 keystore → `Config: null`；有 keystore → `Config: release / Alias: planwave`
- [x] `pnpm typecheck`、`pnpm --filter @planwave/web lint`
- [ ] 配好 Secrets 后打 tag 复核 CI 产物（`apksigner verify --verbose`）
