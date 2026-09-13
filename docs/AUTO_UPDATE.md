# 应用自动更新

PlanWave 桌面端（Windows / macOS / Linux）内置自动更新（Tauri 2 updater 插件），
Android 端提供应用内下载 APK 并拉起系统安装器，Web 端在服务器版本更新后提示刷新。

## 工作原理

- 发版：`v*` 标签触发 release.yml，各端产物上传 GitHub Release；桌面端在配置了
  签名密钥后额外产出 **minisign 签名文件（\*.sig）与 macOS `.app.tar.gz`**，
  并由 release job 聚合生成 **`latest.json`** 更新清单一并上传。
- 更新源（桌面）：`https://github.com/<repo>/releases/latest/download/latest.json`
  （`apps/client/tauri.conf.json` 的 `plugins.updater.endpoints`）。
- 客户端行为矩阵：

| 端                               | 检查                                      | 有新版时                                                                          | 安装方式                               |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------- |
| Windows / macOS / Linux AppImage | 冷启动 5s 后静默检查 + 同步详情页手动检查 | 弹窗展示版本与更新说明                                                            | 应用内下载（进度可见）→ 提示重启安装   |
| Linux deb                        | 同上                                      | 检测非 AppImage 环境（`APPIMAGE` 变量缺失）→ 打开 GitHub Release 页手动下载新 deb | —                                      |
| Android                          | 同上                                      | 应用内下载 APK（进度可见，完成后 sha256 完整性校验）→ 拉起系统安装器              | 系统安装器（FileProvider content URI） |
| Web                              | 每次进入应用                              | `/about` 服务器版本 > 页面构建版本 → 顶部横幅「刷新」                             | location.reload()                      |

- 「跳过此版本」：桌面/Android 的更新弹窗可跳过当前版本（localStorage 记录，
  出现更新的版本才重新提示）；手动检查不受跳过影响。

## 首次配置（维护者，一次性）

Tauri updater 强制要求安装包带 minisign 签名：

1. 生成密钥对（私钥务必妥善保管，**不要**提交进仓库）：

   ```bash
   pnpm --filter @planwave/client exec tauri signer generate -w ~/.tauri/planwave.key
   ```

   命令会输出私钥路径、口令与公钥。

2. 在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：

   | Secret                               | 值                                           |
   | ------------------------------------ | -------------------------------------------- |
   | `TAURI_SIGNING_PRIVATE_KEY`          | 私钥文件内容（`~/.tauri/planwave.key` 全文） |
   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成时设置的口令（无口令则留空）             |

3. 把公钥（`planwave.key.pub` 文件内容）填入 `apps/client/tauri.conf.json` 的
   `plugins.updater.pubkey`（替换 `REPLACE_WITH_UPDATER_PUBKEY` 占位符）。

4. 打一个新 tag 发版：桌面产物将带签名并生成 `latest.json`，自动更新从此生效。

> 未配置密钥时 release.yml 自动跳过签名与 latest.json 生成（打印 notice），
> 合码与发版不受影响；客户端更新检查会静默失败。

## 已知边界

- Linux 的 deb 安装不被 updater 支持（仅 AppImage）；运行时通过 `APPIMAGE`
  环境变量区分并引导手动下载。
- iOS 不参与（未配置分发/签名渠道）。
- 更新源为 GitHub Releases，国内网络直连可能不稳定。
- forget/软删等同步语义与客户端版本无关：服务端容忍各端版本在一段时间内不一致
  （无强制更新机制）。
