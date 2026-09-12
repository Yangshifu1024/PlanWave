# Apple 签名与公证指南（macOS / iOS）

> 前提：你已有 Apple Developer Program 订阅。本文覆盖 GitHub Actions 打包所需的
> 证书导出、Secrets 配置与工作流行为。**macOS 走「Developer ID 签名 + 公证」，
> iOS 走「Ad Hoc 分发签名」**（Ad Hoc 需要把每台设备的 UDID 录入 Profile，
> 单类型上限 100 台）。

---

## 一、macOS 客户端（.dmg 签名 + 公证）

### 1. 生成 Developer ID 证书

1. 登录 [developer.apple.com/account](https://developer.apple.com/account) → Certificates
2. 创建 **Developer ID Application** 证书（注意不是 "Apple Development"，那种只能在 App Store 内部分发用）
3. 在装着该证书的 Mac 上打开「钥匙串访问」，找到
   `Developer ID Application: 你的名字 (TEAMID)`，右键导出为 **.p12**（含私钥），设置导出密码

> 如果本地没有 Mac：可以在任意机器用 `fastlane match` / `cert` 生成，或按 Apple 文档
> 用 CSR 流程在其他 Mac 上完成。你有订阅且本地有 Mac，直接走钥匙串导出即可。

### 2. 配置 GitHub Secrets

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | .p12 文件的 base64：`base64 -i developer-id.p12 \| pbcopy`（Windows: `certutil -encode developer-id.p12 out.txt` 后取正文） |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 |
| `APPLE_SIGNING_IDENTITY` | 证书全名，形如 `Developer ID Application: Yangzhenbiao (ABC1234567)` |
| `APPLE_ID` | 你的 Apple ID 邮箱（公证用） |
| `APPLE_PASSWORD` | App 专用密码（appleid.apple.com → 登录与安全 → App 专用密码生成，**不是账号密码**） |
| `APPLE_TEAM_ID` | 开发者 Team ID（10 位，Membership 页可见） |

### 3. 工作流里发生了什么

release.yml 的 `desktop-macos` job 会：

1. 把 `.p12` 解码导入临时钥匙串并解锁（`security import` / `set-key-partition-list`）
2. `tauri build --target universal-apple-darwin`（同时产出 Apple Silicon + Intel）
   - Tauri 检测到 `APPLE_SIGNING_IDENTITY` 后对 .app / .dmg 做 codesign
   - 检测到 `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` 后自动走 `xcrun notarytool`
     公证并 staple（公证需要联网，约 1~5 分钟）
3. 产物：`PlanWave_x.y.z_universal.dmg` → 上传 GitHub Release

### 4. 验证签名（可选）

```bash
codesign -dv --verbose=2 /Applications/PlanWave.app   # 应显示 Authority=Developer ID Application
spctl -a -vv /Applications/PlanWave.app               # accepted source=Notarized Developer ID
xcrun stapler validate /Applications/PlanWave.app
```

---

## 二、iOS 客户端（.ipa Ad Hoc 签名）

### 1. 后台准备（一次性）

1. **注册 App ID**：Certificates, Identifiers & Profiles → Identifiers → `+` → App IDs →
   Bundle ID 手动输入 `com.planwave.todo`（与 `apps/client/tauri.conf.json` 的
   `identifier` 一致），勾选 Push Notifications（本地通知远端许可不需要，可不勾）
2. **创建 Ad Hoc Distribution 证书**：Certificates → `+` → **Apple Distribution**，
   下载 .cer 后在 Mac 钥匙串里与私钥合并导出 .p12
3. **录入测试设备**：Devices → `+` → 填设备名 + UDID
   （iPhone：设置 → 通用 → 关于本机 → 序列号页面点按可复制 UDID；或用 Finder/爱思助手）
4. **创建 Ad Hoc Profile**：Profiles → `+` → iOS App Development 选 **Ad Hoc** →
   选 App ID `com.planwave.todo` → 选证书 → 勾选所有测试设备 → 下载 `.mobileprovision`

### 2. 配置 GitHub Secrets

| Secret | 内容 |
| --- | --- |
| `IOS_CERTIFICATE` | Apple Distribution .p12 的 base64 |
| `IOS_CERTIFICATE_PASSWORD` | 该 .p12 的导出密码 |
| `IOS_PROVISIONING_PROFILE_BASE64` | `.mobileprovision` 文件的 base64 |

### 3. 工作流里发生了什么

release.yml 的 `ios` job 会：

1. 在 macos runner 上 `tauri ios init` 生成 Xcode 工程（该工程不入库，Windows/Linux 无法生成）
2. 导入 .p12 与 .mobileprovision（`security cms -D` 解出 UUID 后装入
   `~/Library/MobileDevice/Provisioning Profiles/`）
3. `tauri ios build --export-method ad-hoc`：xcodebuild 归档时按 Bundle ID
   自动匹配证书与 Profile，导出 `.ipa`
4. 产物上传 GitHub Release

> **Ad Hoc 安装方式**：把 ipa 拖进 Finder（macOS 侧边栏设备）或用 Apple Configurator /
> 爱思助手侧载；首次启动需在 设置 → 通用 → VPN与设备管理 里信任企业证书（Ad Hoc
> 用的是你的开发者证书，对应显示为开发者 App 信任条目）。

### 4. 未配置 Secrets 的行为

- iOS job 会打印 `::notice::未配置 iOS 签名 Secrets` 并**跳过 ipa 打包**（其余平台不受影响）
- macOS 同理：`APPLE_CERTIFICATE` 为空时跳过钥匙串导入，产物为**未签名 dmg**
  （本机打开需右键 → 打开 绕过 Gatekeeper）

---

## 三、常见坑

| 症状 | 原因 / 处理 |
| --- | --- |
| `errSecItemNotFound` / codesign 找不到身份 | `APPLE_SIGNING_IDENTITY` 必须与证书全名**逐字符一致**（含括号内 Team ID） |
| 公证 401 | `APPLE_PASSWORD` 必须是 App 专用密码，不是 Apple ID 密码 |
| iOS 打包报 `No signing certificate "iOS Distribution" found` | .p12 里没有私钥（只导了证书），重新导出时确认勾选「包含私钥」 |
| 设备安装后闪退 / 无法安装 | UDID 没进 Profile：补录设备后**重新生成 Profile** 并更新 Secret |
| Profile 90 天/1 年后失效 | Ad Hoc Profile 有效期 1 年，过期前重新生成即可；证书本身 3 年 |
