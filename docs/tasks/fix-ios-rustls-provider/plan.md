# 修复：iOS 构建因 rustls 未链接而失败

- 日期：2026-09-17
- 分支：`main`
- 现象报告：`v0.4.9` Release 的「客户端（iOS ipa，App Store 签名）」失败；其余平台与 GitHub Release 草稿均成功。

## 根因

PR #13（`21a4878`）在 `apps/client/src/lib.rs` 用 `#[cfg(mobile)]` 于 `run()` 里安装 rustls crypto provider（覆盖 Android **和** iOS），但 `rustls` 依赖只写在 `[target.'cfg(target_os = "android")'.dependencies]`。iOS 编译该 `cfg` 分支时 crate 未链接：

```
error[E0433]: cannot find module or crate `rustls` in this scope
  --> apps/client/src/lib.rs:22:8
```

Android 构建因此通过，iOS 在 CI 才暴露。`release.yml` 的 GitHub Release job 不 `needs: ios`（ipa 只作为 Actions artifact，不进 Release 资产），所以草稿仍生成，只是没有 ipa。

## 方案

把 `rustls` 从 Android-only 段挪到与 `#[cfg(mobile)]` 对齐的目标：

```toml
[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]
rustls = { version = "0.23", default-features = false, features = ["ring"] }
```

版本与 features 仍与上游 tauri 一致（0.23，`default-features = false`，仅 `ring`）。`lib.rs` 的安装逻辑不改。

不复用 `v0.4.9` tag。需要绿的 ipa 时另切 `v0.4.10`。

## 验证

- `cargo metadata --filter-platform aarch64-apple-ios`：`planwave` 直接依赖 `rustls`。
- `cargo metadata --filter-platform aarch64-linux-android`：同样直接依赖 `rustls`（Android 回归）。
- `cargo metadata --filter-platform x86_64-pc-windows-msvc`：`planwave` **不**直接依赖 `rustls`（桌面未引入多余 crate）。
- 本机 Windows 无法跑 `tauri ios build`；完整 iOS 编译只能在下次带 tag 的 Release CI 上确认。

## 回滚

```bash
git checkout -- apps/client/Cargo.toml
```
