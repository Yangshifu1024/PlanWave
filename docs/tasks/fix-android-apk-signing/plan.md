# 修复：Release 的 Android APK 未签名，装机报「解析失败：安装包没有签名文件」

- 日期：2026-09-16
- 分支：`fix/android-apk-signing`
- 现象报告：从 GitHub Release 下载的 `PlanWave_<版本>_universal.apk` 安装时报「解析失败 安装包没有签名文件」。

## 根因

发布产物是 gradle 产出的 `app-universal-release-unsigned.apk`，而流水线把它改名成 `PlanWave_<版本>_universal.apk` 后照常上传，`unsigned` 标记被抹掉，于是在 Release 上架了一个装不上的包。

三层原因叠加：

1. **gradle 侧没有签名配置**。`apps/client/gen/android/app/build.gradle.kts` 里既无 `signingConfigs` 块，`release` buildType 也未指定 `signingConfig`。Tauri 官方模板本就不带这段（文档要求手动添加），因此 release 构建必然产出 `-unsigned.apk`。
2. **CI 里配置签名的环境变量不存在**。`release.yml` 原来设置 `TAURI_ANDROID_KEYSTORE_PATH` / `TAURI_ANDROID_KEYSTORE_PASSWORD` / `TAURI_ANDROID_KEY_ALIAS` / `TAURI_ANDROID_KEY_PASSWORD` 并据此解码 keystore；但 tauri-cli 与 cargo-mobile2 源码中均无这些字符串——`TAURI_ANDROID_KEYSTORE_*` 不是 Tauri 的功能，这四个变量是空操作（仓库 Secrets 里也确实没有对应的 `ANDROID_KEYSTORE_*`）。仓库中唯一的 keystore 相关线索是 Tauri 模板 `.gitignore` 里的 `keystore.properties`。
3. **流水线没有校验产物**。`release.yml` 的「整理产物」步骤用 `upload/*.apk` 通配改名，`if-no-files-found: error` 只保证「有文件」，不保证「已签名」；未签名包因此能一路走到 Release。

## 证据

- `PlanWave_0.4.6_universal.apk`：`unzip -l` 无 `META-INF/*.RSA|DSA|EC`；二进制中不含 v2/v3 签名块魔数 `APK Sig Block 42`；`apksigner verify --verbose` → `DOES NOT VERIFY / ERROR: Missing META-INF/MANIFEST.MF`。
- v0.4.6 的 Android job 日志：产物路径为 `.../apk/universal/release/app-universal-release-unsigned.apk`，`TAURI_ANDROID_KEYSTORE_PASSWORD` 为空。
- GitHub Secrets 列表中无任何 `ANDROID_KEYSTORE_*`。
- 对照 Tauri 官方文档（Android Code Signing）：签名靠 `gen/android/keystore.properties` + `app/build.gradle.kts` 的 `signingConfigs` 块，CI 里由工作流生成该 properties 文件。

## 修复方案

### 1. gradle 增加 release 签名配置

`apps/client/gen/android/app/build.gradle.kts`：

- 读取 `rootProject.file("keystore.properties")`（即 `apps/client/gen/android/keystore.properties`，两处 `.gitignore` 均已忽略该文件）；
- 文件存在时注册 `signingConfigs.create("release")` 并把它挂到 `buildTypes.release`；
- 文件缺失时不注册签名配置，gradle 仍产出 `-unsigned.apk`——由 CI 校验兜住（见 3），本地无密钥构建也不会在配置阶段直接失败。

### 2. CI 按官方方式生成 keystore.properties

`release.yml` 的 Android job：

- 新增「配置 Android 签名」步骤：从 `ANDROID_KEYSTORE_BASE64` 解码出 keystore 到 `$RUNNER_TEMP`，写入 `apps/client/gen/android/keystore.properties`（`password` / `keyAlias` / `storeFile`），并输出 `signed=true`；
- 三个 Secret 任一缺失时输出 `signed=false` 并打印 notice（与 iOS 未配置签名时跳过 ipa 的行为对齐），跳过 build；删除那四个无效的 `TAURI_ANDROID_KEYSTORE_*`。

### 3. 未签名包 fail-loud，绝不发布

- Android job 新增「校验 APK 已签名」步骤：universal 产物必须恰好 1 个、文件名不含 `unsigned`、且命中 v1（`META-INF/*.RSA|DSA|EC`）或 v2/v3（`APK Sig Block 42`，签名在 APK Signing Block 中，`unzip` 看不到证书）签名，任一不满足即报错退出；只认 v2 会在 AGP 关闭 v2 时误杀构建，故两者取或；
- 「整理产物」步骤加兜底：发现文件名含 `unsigned` 的 APK 就地失败，不进入 Release；
- `scripts/gen-latest-json.mjs`：`--apk` / `--apk-sha256` 改为可选且必须成对，未提供时 `latest.json` 省略 `android` 段（前端 `apps/web/src/lib/updater.ts` 已对 `manifest.android` 缺失做判空，无需改动）；`release.yml` 仅在 APK 文件存在时传入这两个参数。

### 4. 文档

- 新增 `docs/ANDROID_SIGNING.md`：keystore 生成、本地签名构建、CI Secrets 配置、产物验证、常见问题；
- `README.md` 各端构建处补一句指向该文档。

## 密钥落地（2026-09-16 完成）

- 已在本机生成 `~/planwave.keystore`（PKCS12，RSA 2048，10 年有效，alias `planwave`），口令由 `openssl rand -hex 16` 生成；
- 本地 `apps/client/gen/android/keystore.properties` 已写入（被 `.gitignore` 忽略），本机 `pnpm build:android` 即为签名包；
- 三个 Secrets 已写入 `Yangshifu1024/PlanWave`：`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS`；
- **keystore 与口令必须长期备份**：丢失后无法以同一签名覆盖安装/升级，已安装用户只能卸载重装。

## 遗留事项

- 历史 Release（v0.4.6 及更早）上的未签名 APK 暂不清理，由下个版本覆盖（已与用户确认）。

## 验证

- [x] `node --check scripts/gen-latest-json.mjs` + 参数组合手动跑通（无 apk → `android` 段省略 / 有 apk → 段完整 / 只给 `--apk` → 报「必须成对提供」）
- [x] `actionlint .github/workflows/release.yml`：无 error/warning，shellcheck 告警数与改动前一致（5 条既有 SC2086/SC2012）
- [x] gradle 签名配置实测（临时目录内为 CLI 生成物打桩后跑 `:app:signingReport`）：
  - 无 `keystore.properties` → `Variant: universalRelease / Config: null`（即 `-unsigned.apk`，与线上现象一致）
  - 有 `keystore.properties` → `Config: release / Store: <临时 keystore> / Alias: planwave`
- [x] `pnpm typecheck`、`pnpm --filter @planwave/web lint` 通过（本次未改 Rust / TS 源码，clippy 无需重跑）
- [ ] 配好 Secrets 后打 tag 复核 CI 签名产物（`apksigner verify --verbose`）
