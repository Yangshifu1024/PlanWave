//! Android 专用：应用内下载新版 APK 并拉起系统安装器。
//!
//! - `download_update_apk`：reqwest 流式下载到应用缓存目录，
//!   经 `update://apk-progress` 事件回报进度（received/total 字节）；
//! - `install_update_apk`：经 FileProvider content URI 发 ACTION_VIEW
//!   安装 Intent（`application/vnd.android.package-archive`）。
//!
//! FileProvider 由 gen/android 的 AndroidManifest 提供（authority =
//! `<packageName>.fileprovider`，paths 含 cache-path）。

use tauri::AppHandle;

/// 下载进度事件名（前端 `listen` 用；仅 Android 下载路径发出）。
#[cfg(target_os = "android")]
pub const PROGRESS_EVENT: &str = "update://apk-progress";

#[tauri::command]
pub async fn download_update_apk(
    app: AppHandle,
    url: String,
    version: String,
    sha256: Option<String>,
) -> Result<String, String> {
    download_impl(app, &url, &version, sha256.as_deref())
        .await
        .map(|p| p.display().to_string())
}

#[tauri::command]
pub fn install_update_apk(app: AppHandle, path: String) -> Result<(), String> {
    install_impl(&app, &path).map_err(|e| e.to_string())
}

/// 当前是否以 AppImage 运行（Linux 桌面判断能否自动更新；
/// 其他平台恒为 false——调用方只在 Linux 桌面分支使用）。
#[tauri::command]
pub fn is_appimage() -> bool {
    std::env::var("APPIMAGE")
        .map(|v| !v.is_empty())
        .unwrap_or(false)
}

#[cfg(target_os = "android")]
async fn download_impl(
    app: AppHandle,
    url: &str,
    version: &str,
    expected_sha256: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    use futures_util::StreamExt;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tauri::Manager;

    /// 进度事件节流：每累计 256KiB 上报一次（避免数千次 IPC/重渲染）。
    const PROGRESS_STEP: u64 = 256 * 1024;

    let safe_version = version.replace(['/', '\\', ':', ' '], "_");
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let path = dir.join(format!("planwave-{safe_version}.apk"));

    let resp = reqwest::get(url)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("下载失败: {e}"))?;
    let total = resp.content_length().unwrap_or(0);

    let mut file = std::fs::File::create(&path).map_err(|e| format!("创建文件失败: {e}"))?;
    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last_reported: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {e}"))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|e| format!("写入失败: {e}"))?;
        received += chunk.len() as u64;
        if received - last_reported >= PROGRESS_STEP {
            last_reported = received;
            let _ = app.emit(
                PROGRESS_EVENT,
                serde_json::json!({ "received": received, "total": total }),
            );
        }
    }
    let _ = app.emit(
        PROGRESS_EVENT,
        serde_json::json!({ "received": received, "total": if total == 0 { received } else { total } }),
    );

    // 完整性校验：latest.json 提供 sha256，落地后比对，不一致即删除并报错
    if let Some(expected) = expected_sha256 {
        let expected = expected.trim().to_lowercase();
        let actual = format!("{:x}", hasher.finalize());
        if expected != actual {
            drop(file);
            std::fs::remove_file(&path).ok();
            return Err(format!(
                "APK 完整性校验失败（期望 sha256 {expected}，实际 {actual}），已删除下载文件"
            ));
        }
    }
    Ok(path)
}

#[cfg(target_os = "android")]
fn install_impl(app: &AppHandle, path: &str) -> Result<(), String> {
    use jni::objects::{JObject, JValue};
    use tauri::Manager;

    // 调用方传入缓存目录内的路径；FileProvider 的 cache-path 已放行该目录
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {e}"))?;
    let apk_name = std::path::Path::new(path)
        .file_name()
        .ok_or("非法的 APK 路径")?;
    let apk_path = cache_dir.join(apk_name);
    if !apk_path.exists() {
        return Err(format!("APK 不存在: {}", apk_path.display()));
    }

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| e.to_string())?;
    let mut env = vm.attach_current_thread().map_err(|e| e.to_string())?;

    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // authority = <packageName>.fileprovider
    let package = env
        .call_method(&activity, "getPackageName", "()Ljava/lang/String;", &[])
        .map_err(|e| e.to_string())?
        .l()
        .map_err(|e| e.to_string())?;
    let package: String = env
        .get_string((&package).into())
        .map_err(|e| e.to_string())?
        .into();
    let authority = env
        .new_string(format!("{package}.fileprovider"))
        .map_err(|e| e.to_string())?;

    // java.io.File(apkPath)
    let j_path = env
        .new_string(apk_path.display().to_string())
        .map_err(|e| e.to_string())?;
    let file = env
        .new_object(
            "java/io/File",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&j_path)],
        )
        .map_err(|e| e.to_string())?;

    // uri = FileProvider.getUriForFile(activity, authority, file)
    let uri = env
        .call_static_method(
            "androidx/core/content/FileProvider",
            "getUriForFile",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
            &[
                JValue::Object(&activity),
                JValue::Object(&authority),
                JValue::Object(&file),
            ],
        )
        .map_err(|e| format!("FileProvider 调用失败: {e}"))?
        .l()
        .map_err(|e| e.to_string())?;

    // intent = new Intent(Intent.ACTION_VIEW)
    let action_view = env
        .new_string("android.intent.action.VIEW")
        .map_err(|e| e.to_string())?;
    let intent = env
        .new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&action_view)],
        )
        .map_err(|e| e.to_string())?;

    // intent.setDataAndType(uri, "application/vnd.android.package-archive")
    let mime = env
        .new_string("application/vnd.android.package-archive")
        .map_err(|e| e.to_string())?;
    env.call_method(
        &intent,
        "setDataAndType",
        "(Landroid/net/Uri;Ljava/lang/String;)Landroid/content/Intent;",
        &[JValue::Object(&uri), JValue::Object(&mime)],
    )
    .map_err(|e| e.to_string())?;

    // intent.addFlags(FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK)
    const FLAG_GRANT_READ: i32 = 1;
    const FLAG_NEW_TASK: i32 = 0x1000_0000;
    env.call_method(
        &intent,
        "addFlags",
        "(I)Landroid/content/Intent;",
        &[JValue::Int(FLAG_GRANT_READ | FLAG_NEW_TASK)],
    )
    .map_err(|e| e.to_string())?;

    // activity.startActivity(intent)
    env.call_method(
        &activity,
        "startActivity",
        "(Landroid/content/Intent;)V",
        &[JValue::Object(&intent)],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
async fn download_impl(
    _app: AppHandle,
    _url: &str,
    _version: &str,
    _expected_sha256: Option<&str>,
) -> Result<std::path::PathBuf, String> {
    Err("仅 Android 支持应用内下载 APK".into())
}

#[cfg(not(target_os = "android"))]
fn install_impl(_app: &AppHandle, _path: &str) -> Result<(), String> {
    Err("仅 Android 支持应用内安装 APK".into())
}
