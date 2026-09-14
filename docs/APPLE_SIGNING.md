# Apple 签名与公证指南（macOS / iOS）

> 前提：已加入 Apple Developer Program（$99/年）。Bundle ID：`xyz.yangshifu.planwave`
> （与 `apps/client/tauri.conf.json` 的 `identifier` 一致）。
>
> 两端分工：**macOS 走「Developer ID 签名 + 公证」**——dmg 直接发 GitHub Releases 并支持自动更新；
> **iOS 走「App Store 分发签名」**——TestFlight 内测 + 正式上架，无需注册设备 UDID。
>
> 本章覆盖「本机手动完成一遍」与「GitHub Actions 自动化」两条路径：证书材料都先在本机创建，
> 本地签名验证通过后，把 .p12 / Profile 以 base64 配进 Secrets，CI 即可复现同样流程。

---

## 〇、本机自检（一次性）

| 检查项 | 命令 / 位置 | 期望结果 |
| --- | --- | --- |
| Xcode 完整版 | `xcodebuild -version && xcode-select -p` | 显示版本号，路径指向 `/Applications/Xcode.app` |
| 钥匙串签名身份 | `security find-identity -v -p codesigning` | 创建证书后应出现对应条目 |
| 公证工具 | `xcrun notarytool --version` | 随 Xcode 自带，显示版本号 |
| Team ID | [developer.apple.com/account](https://developer.apple.com/account) → Membership details | 10 位字母数字，多处 Secret 会用到 |

---

## 一、macOS：Developer ID 签名 + 公证

### 1. 创建 Developer ID Application 证书（一次性）

- **Xcode 路线（推荐）**：Xcode → Settings → Accounts → 选中团队 → Manage Certificates… →
  左下角「+」→ **Developer ID Application**
- **网页 CSR 路线**：developer.apple.com → Certificates → 「+」→ Developer ID Application →
  用「钥匙串访问 → 证书助理 → 从证书颁发机构请求证书」生成 .csr 上传 → 下载 .cer 双击导入钥匙串

注意：是 **Developer ID Application**，不是 "Apple Development"（后者只能开发/内部分发用）；
它与 iOS 侧的 "Apple Distribution" 是两类证书，互不占用额度。

验证：

```bash
security find-identity -v -p codesigning
# 应看到： "Developer ID Application: 你的名字 (TEAMID)"
```

### 2. 公证凭据（App Store Connect API Key）

本仓库统一走 **App Store Connect API Key** 公证路线（不用 App 专用密码）：
账号级凭据、跨产品共用、与 2FA 无关。已有现成密钥可直接复用：

- Key ID：`8TXR75R484`，Issuer ID：`92f97c49-4ee9-45f3-8840-01b96de486a2`
- 本机路径：`~/.appstoreconnect/private_keys/AuthKey_8TXR75R484.p8`
  （notarytool / altool 的默认搜索路径，本地构建无需额外配置）
- 密钥角色必须是 **App Manager**（Developer 角色公证会 403）

如需新建：App Store Connect → 用户和访问 → 集成 → Individual Keys → 生成（App Manager 权限）
→ 下载 .p8（**只能下载一次**）存到 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`。

> App 专用密码路线（`APPLE_ID` + `APPLE_PASSWORD`）Tauri 同样支持，仅作备选，本仓库 CI 不使用。

### 3. 本地构建（签名 + 公证一步到位）

```bash
# 首次：装 universal 双架构 target
rustup target add aarch64-apple-darwin x86_64-apple-darwin

export APPLE_SIGNING_IDENTITY="Developer ID Application: Frank Yang (ZE5SZ85EZQ)"
export APPLE_API_ISSUER="92f97c49-4ee9-45f3-8840-01b96de486a2"
export APPLE_API_KEY="8TXR75R484"
# .p8 已在 ~/.appstoreconnect/private_keys/（默认搜索路径）；
# 若放在别处需再 export APPLE_API_KEY_PATH="/绝对路径/AuthKey_8TXR75R484.p8"

pnpm --filter @planwave/client exec tauri build --target universal-apple-darwin --bundles dmg
```

- `beforeBuildCommand` 会自动跑 wasm + web 构建，无需手动预构建
- Tauri 检测到 `APPLE_SIGNING_IDENTITY` 即对 .app / .dmg 做 codesign（自动启用 hardened runtime）；
  检测到 `APPLE_API_ISSUER` + `APPLE_API_KEY`（+ `APPLE_API_KEY_PATH`）即自动 `xcrun notarytool`
  公证并 staple（需联网，约 1~5 分钟）
- **注意：Tauri 只公证 .app，dmg 只做 codesign**。直接分发 dmg 需手动补一轮公证：
  ```bash
  DMG=$(ls target/universal-apple-darwin/release/bundle/dmg/*.dmg | head -n1)
  xcrun notarytool submit "$DMG" --key-id "8TXR75R484" \
    --issuer "92f97c49-4ee9-45f3-8840-01b96de486a2" \
    --key ~/.appstoreconnect/private_keys/AuthKey_8TXR75R484.p8 --wait
  xcrun stapler staple "$DMG"
  ```
- 产物：`target/universal-apple-darwin/release/bundle/dmg/PlanWave_<版本>_universal.dmg`

**进阶：本地复现 CI 的自动更新产物**（.app.tar.gz + minisign .sig）：

```bash
# tauri.updater.conf.json 会清空 beforeBuildCommand，需先手动构建前端
pnpm build:wasm && pnpm --filter @planwave/web build

export TAURI_SIGNING_PRIVATE_KEY="minisign 私钥内容"        # 见 docs/AUTO_UPDATE.md
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="对应密码"

pnpm --filter @planwave/client exec tauri build --target universal-apple-darwin \
  --bundles dmg,app --config tauri.updater.conf.json
```

### 4. 验证签名

```bash
APP=target/universal-apple-darwin/release/bundle/macos/PlanWave.app
codesign -dv --verbose=2 "$APP"       # Authority=Developer ID Application；flags 含 runtime(hardened)
codesign --verify --strict "$APP"     # 无输出即通过
spctl -a -vv "$APP"                   # accepted，source=Notarized Developer ID
xcrun stapler validate "$APP"         # The validate action worked!
DMG=$(ls target/universal-apple-darwin/release/bundle/dmg/*.dmg | head -n1)
xcrun stapler validate "$DMG"         # dmg 的公证票据（需先完成上面的 dmg 补公证）
```

再挂载 dmg 实际安装打开一次；未签名的 dmg 需右键 → 打开绕过 Gatekeeper（签名公证后不再需要）。

### 5. 配置 CI Secrets

钥匙串访问 → 我的证书 → 选中 Developer ID Application 证书（展开确认含私钥）→
右键「导出…」→ 格式选 .p12 → 设置导出密码，然后：

```bash
base64 -i developer-id.p12 | pbcopy   # base64 直接粘进 GitHub Secret
```

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | .p12 文件的 base64 |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Frank Yang (ZE5SZ85EZQ)` |
| `APPLE_API_ISSUER` | `92f97c49-4ee9-45f3-8840-01b96de486a2` |
| `APPLE_API_KEY` | `8TXR75R484` |
| `APPLE_API_KEY_P8` | .p8 文件原文（含 BEGIN/END PRIVATE KEY 整段） |
| `APPLE_TEAM_ID` | `ZE5SZ85EZQ`（macOS job 不再用，`ios` job 注入 `APPLE_DEVELOPMENT_TEAM`） |

> **复用提示**：以上凭据全部是账号/团队级，与其他产品（如 CodeWave）完全共用，值可直接复制。
> 唯一的例外是 `TAURI_SIGNING_PRIVATE_KEY`（updater minisign 密钥）——**项目级**，不能跨项目共用，
> 见 `docs/AUTO_UPDATE.md`。
>
> **证书有效期至 2027-02-01**：到期重建证书后只需更新 `APPLE_CERTIFICATE` /
> `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` 三个 Secret，公证凭据不受影响。

### 6. CI 行为（配置 Secrets 后无需任何操作）

`release.yml` 的 `desktop-macos` job：把 .p12 解码导入临时钥匙串 → .p8 落盘为绝对路径 →
`tauri build --target universal-apple-darwin`（codesign + .app 公证 staple）→
**对 dmg 补公证 + stapler 钉票**（tauri-bundler 不公证 dmg）→ dmg 与 `.app.tar.gz(.sig)`
上传 Release。未配置 Secrets 时仍出**未签名 dmg**。

---

## 二、iOS：App Store 分发签名

### 1. 后台一次性准备

1. **注册显式 App ID**：developer.apple.com → Certificates, Identifiers & Profiles →
   Identifiers → 「+」→ App IDs → App → Bundle ID 手动输入 `xyz.yangshifu.planwave`，
   勾选项全部留空（本地通知不占 capability）
2. **创建 Apple Distribution 证书**：Certificates → 「+」→ **Apple Distribution** →
   （CSR 流程同上）→ 下载 .cer 导入钥匙串 → **右键导出 .p12（务必含私钥）**。
   个人账号同时只能有 1 个有效的 Apple Distribution 证书
3. **创建 App 记录**：[App Store Connect](https://appstoreconnect.apple.com) → 我的 App → 「+」→
   新建 App：名称、主要语言、Bundle ID 选 `xyz.yangshifu.planwave`、SKU 随意（如 `planwave`）
4. **创建 App Store Profile**：Profiles → 「+」→ **App Store Connect 分发** →
   选 App ID `xyz.yangshifu.planwave` → 选刚才的证书 → 下载 `.mobileprovision`。
   与 Ad Hoc 的关键区别：**不需要注册任何设备 UDID**

### 2. 本地构建（Tauri CLI 原生吃环境变量，无需手动开 Xcode）

```bash
# 首次：iOS target + 生成 Xcode 工程（gen/apple/ 不入库，可随时重新生成）
rustup target add aarch64-apple-ios
pnpm --filter @planwave/client exec tauri ios init

export APPLE_DEVELOPMENT_TEAM="10位TeamID"                    # CLI 会写入工程 DEVELOPMENT_TEAM
export IOS_CERTIFICATE="$(base64 -i apple-dist.p12)"          # .p12 的 base64
export IOS_CERTIFICATE_PASSWORD="导出p12时设的密码"
# Profile 解析走 ASC API key 自动签名（本机与 CI 同一路径）：
export APPLE_API_ISSUER="92f97c49-4ee9-45f3-8840-01b96de486a2"
export APPLE_API_KEY="8TXR75R484"
# .p8 已在 ~/.appstoreconnect/private_keys/（默认搜索路径），放别处需 export APPLE_API_KEY_PATH

pnpm --filter @planwave/client exec tauri ios build --export-method app-store-connect
```

> ⚠️ **不要使用 `IOS_MOBILE_PROVISION` 环境变量**：tauri CLI 存在 bug
> （[tauri#14462](https://github.com/tauri-apps/tauri/issues/14462)，截至 CLI 2.11 未修复），
> 会把 `PROVISIONING_PROFILE_SPECIFIER` 写到 pbxproj 的 buildSettings 字典外面，
> 导致 xcodebuild 报 `requires a provisioning profile`。Profile 一律交给 ASC API key 自动签名解析。

产物：`apps/client/gen/apple/build/arm64/PlanWave.ipa`（构建日志也会打印路径）。

> `--export-method` 合法取值（Tauri CLI 2.x）：`app-store-connect`（上架/TestFlight）、
> `release-testing`、`debugging`。旧文档里的 `ad-hoc` 是无效值，会直接报错。

**备选：Xcode GUI（命令行排查签名问题时最稳）**：
`pnpm --filter @planwave/client exec tauri ios build --open` 打开工程 →
Signing & Capabilities → Team 选个人团队 → Product → Archive → Distribute App →
App Store Connect → Upload。

> **Xcode GUI 打不开也能走完全程**（如 beta 系统上 GUI 崩溃）：证书创建改走「网页 CSR 路线」
> （上一节的证书助理只依赖钥匙串访问，不需要 Xcode）；`tauri ios build` 只调用命令行
> `xcodebuild`，不依赖 GUI——前提是 `xcodebuild -showsdks` 能正常列出 iOS SDK。
> 实在不行还有兜底：GitHub Actions 的 macOS runner 用稳定版 Xcode，配好 Secrets 后由 CI 出 ipa。

### 3. 上传 App Store Connect

- **Transporter（推荐）**：Mac App Store 免费下载 → 打开拖入 .ipa → 「交付」
- **或命令行 altool**：先在 App Store Connect → 用户和访问 → 集成 → **Individual Keys** 创建
  API 密钥（Developer 权限），下载 .p8 保存为 `~/private_keys/AuthKey_<KEY_ID>.p8`，然后：

  ```bash
  xcrun altool --upload-app --type ios \
    --file "apps/client/gen/apple/build/arm64/PlanWave.ipa" \
    --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
  ```

### 4. TestFlight 与提交审核

- 上传后 ASC → TestFlight 标签等待处理；首次需回答**出口合规**（应用只用 HTTPS 标准加密 →
  选标准豁免即可）。内部测试员（≤100 人）即传即用；外部测试需 Beta 审核
- **提交审核**：App Store 标签 → 新建版本 → 截图（至少 6.9 英寸 iPhone 一套）、描述、
  **隐私政策 URL**（必填）、App Privacy 问卷、年龄分级 → 提交
- 审核备注可说明：PlanWave 支持完全离线使用，同步服务器为可选项，无账号也能用全部核心功能

### 5. 配置 CI Secrets（2 个 + 复用 4 个）

| Secret | 内容 |
| --- | --- |
| `IOS_CERTIFICATE` | Apple Distribution .p12 的 base64：`base64 -i apple-dist.p12 \| pbcopy` |
| `IOS_CERTIFICATE_PASSWORD` | 该 .p12 的导出密码 |
| `APPLE_TEAM_ID` | `ZE5SZ85EZQ`（注入 `APPLE_DEVELOPMENT_TEAM`） |
| `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_P8` | 与 macOS 共用（profile 自动签名解析） |

> `IOS_PROVISIONING_PROFILE_BASE64` 目前 CI 不再读取（Profile 由 ASC API key 自动解析），
> 配置与否不影响构建。

### 6. CI 行为

`release.yml` 的 `ios` job：`tauri ios init` 生成工程 → 证书经 `IOS_CERTIFICATE*` 导入
Tauri 临时钥匙串，Profile 由 ASC API key 自动签名解析（规避 tauri#14462 的 pbxproj 写坏 bug）→
`tauri ios build --export-method app-store-connect` → **ipa 上传为 workflow artifact
（`client-ios`）**，从 Actions 运行页下载后按上节方式上传 App Store Connect。
ipa 不进 GitHub Release（iOS 分发渠道是 App Store）。未配置 Secrets 时跳过并打 notice。

---

## 三、常见坑

| 症状 | 原因 / 处理 |
| --- | --- |
| `errSecItemNotFound` / codesign 找不到身份 | `APPLE_SIGNING_IDENTITY` 必须与 `security find-identity` 输出**逐字符一致**（含括号内 Team ID） |
| 公证 401 | `APPLE_PASSWORD` 必须是 App 专用密码，不是 Apple ID 账号密码（本仓库走 API Key 路线，不适用） |
| 公证 403 | ASC API Key 角色必须是 **App Manager**（Developer 角色没有公证权限） |
| dmg 被 Gatekeeper 判 `Unnotarized` | Tauri 只公证 .app；dmg 需手动 notarytool + stapler（本地手动补，CI 已内置后置步骤） |
| `No signing certificate "iOS Distribution" found` | .p12 里没有私钥（只导了证书），重新导出并确认包含私钥 |
| iOS 报 `requires a development team` | 没设 `APPLE_DEVELOPMENT_TEAM`（本地也可在 Xcode 里选一次 Team） |
| `--export-method` 报 invalid value | 取值是 `app-store-connect` / `release-testing` / `debugging`；`ad-hoc` 是无效旧写法 |
| `No profiles for 'xyz.yangshifu.planwave' were found` | 后台还没创建该 App ID / Profile，或 Xcode 未登录对应账号（Settings → Accounts 下载） |
| 改 bundle id 后旧包无法原地升级 | bundle id / applicationId 变化等于「新应用」（本仓库已从 `com.planwave.todo` 迁移到 `xyz.yangshifu.planwave`），需卸载重装 |
| Profile / 证书过期 | App Store Profile 有效期 1 年，证书约 3 年；过期前后台重新生成并更新对应 Secret |
