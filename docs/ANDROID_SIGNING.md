# Android APK 签名指南

> 背景：Android 强制要求安装包带签名。未签名的 release APK 装机会报
> **「解析失败：安装包没有签名文件」**（`apksigner verify` 报 `DOES NOT VERIFY /
> Missing META-INF/MANIFEST.MF`）。历史上本仓库就曾静默发布过未签名 APK（见
> `docs/tasks/fix-android-apk-signing/plan.md`）。
>
> 本章覆盖「本机手动完成一遍」与「GitHub Actions 自动化」两条路径：
> keystore 在本机创建，本地验证通过后把 keystore 以 base64 配进 Secrets，CI 即可复现同样流程。

---

## 〇、机制与关键约定

- Tauri 官方 Android 模板**不带**签名配置，需要在
  `apps/client/gen/android/app/build.gradle.kts` 手动写 `signingConfigs`（本仓库已加）。
- 配置来源固定为 `apps/client/gen/android/keystore.properties`（已被 `.gitignore` 忽略，**不要提交**）：

  ```properties
  password=<keystore 密码>
  keyAlias=<别名>
  storeFile=<keystore 的绝对路径>
  ```

  gradle 侧把 `password` 同时用作 store password 与 key password，因此 keystore 请用同一口令生成。
- **`TAURI_ANDROID_KEYSTORE_*` 之类的环境变量不存在**——它既不是 tauri-cli 也不是 cargo-mobile2 的功能，写了也不会签名（早期 release.yml 踩过这个坑）。
- `keystore.properties` 缺失时，gradle 产出 `app-universal-release-unsigned.apk`；CI 的签名校验会直接失败，未签名包不会进入 Release。

---

## 一、一次性：创建 keystore

```bash
keytool -genkey -v -keystore ~/planwave.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 -alias planwave
```

- `keytool` 可能不在 PATH：macOS 用 `/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool`。
- **务必长期保管 `~/planwave.keystore` 与口令**。Android 要求同一应用的升级包使用同一签名：keystore 丢失后无法覆盖安装/升级，已安装用户只能卸载重装。
- 该文件不要进版本库、不要进公开网盘。

---

## 二、本地构建签名 APK

1. 写入 `apps/client/gen/android/keystore.properties`：

   ```properties
   password=<你的密码>
   keyAlias=planwave
   storeFile=/Users/<你的用户名>/planwave.keystore
   ```

   `storeFile` 用绝对路径最稳（`file()` 是相对 `app/` 解析的）。

2. 构建：

   ```bash
   pnpm build:wasm     # 首次或数据层有改动时
   pnpm build:android  # = tauri android build --apk
   ```

3. 产物与验证：

   ```bash
   APK=apps/client/gen/android/app/build/outputs/apk/universal/release/*.apk
   ls -l $APK                     # 文件名不应含 "unsigned"
   $HOME/Library/Android/sdk/build-tools/36.0.0/apksigner verify --verbose $APK
   # 期望：Verifies / Verified using v2 scheme (APK Signature Scheme v2): true
   ```

   注意：v2/v3 签名位于 APK Signing Block（`unzip -l` 看不到证书），早期版本的 v1 签名才会在 `META-INF/` 下留 `.RSA`。

---

## 三、CI：配置 GitHub Secrets

| Secret | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | keystore 的 base64（见下） |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 口令（store / key 共用） |
| `ANDROID_KEY_ALIAS` | `planwave` |

导出 base64（**必须单行**）：

```bash
# macOS
base64 -i ~/planwave.keystore
# Linux
base64 -w0 ~/planwave.keystore
```

写入 Secrets（`gh` 需有仓库 admin 权限）：

```bash
base64 -i ~/planwave.keystore | gh secret set ANDROID_KEYSTORE_BASE64 -R <owner>/<repo>
gh secret set ANDROID_KEYSTORE_PASSWORD -R <owner>/<repo>
gh secret set ANDROID_KEY_ALIAS -R <owner>/<repo>   # 例：planwave
```

`release.yml` 的 Android job 流程：**配置 Android 签名**（解码 keystore → 写 `keystore.properties`）→ **Tauri android build** → **校验 APK 已签名**（恰好 1 个产物、文件名不含 `unsigned`、且含 v1（`META-INF/*.RSA|DSA|EC`）或 v2/v3（`APK Sig Block 42`）签名）→ 上传产物。

未配置这三个 Secret 时：**CI 直接失败**（报「缺少 Secrets：…」），不会产出 Release。

> 为什么不「跳过 APK 继续发版」：那样 Release 会少一个端，而 Android 端检查更新拿到不带
> `android` 段的 `latest.json` 会显示「已是最新版本」，用户完全无感知——静默降级比流水线红更糟。
> 确实要出一个不含 Android 包的 Release 时，请显式移除该 job。

---

## 四、验证已发布产物

```bash
VERSION=0.5.0
gh release download v$VERSION -R <owner>/<repo> -p "PlanWave_${VERSION}_universal.apk"
apksigner verify --verbose PlanWave_${VERSION}_universal.apk
```

带 `draft: true` 的 Release 在手动 Publish 前不出现在 `releases/latest` 端点，可先下载草稿产物验证再发布。

---

## 五、常见问题

| 现象 | 原因 / 对策 |
| --- | --- |
| 解析失败：安装包没有签名文件 | 产物是 `*-unsigned.apk`（未配签名）。检查 `keystore.properties` 是否存在、Secret 是否齐全 |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 待装包与已安装包签名不同（换过 keystore / 装过 debug 包）。卸载旧包后重装；之后所有版本必须用同一 keystore |
| `App not installed` 且已装更高 `versionCode` | Release 的 `versionCode` 由 tag 推导（`major*1e6 + minor*1e3 + patch`），需发更高的 tag |
| CI 报「APK 未找到 v1/v2/v3 签名」 | 签名配置未生效：确认 `keystore.properties` 已生成且路径正确、Secret 内容未被换行/转义破坏 |
