//! PlanWave Tauri 壳：窗口、本地通知与应用自动更新。
//!
//! 数据层统一走前端 WASM 同步引擎（IndexedDB），各端（Windows/macOS/Linux/
//! Android/iOS）与 Web 共用同一套构建产物，壳本身不含任何存储逻辑。
//!
//! 自动更新：桌面端由 tauri-plugin-updater 接管（签名校验 + 下载 + 重启安装）；
//! Android 无 updater 渠道，由 update_apk 模块负责应用内下载 APK 并拉起安装器。

mod update_apk;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            update_apk::download_update_apk,
            update_apk::install_update_apk,
            update_apk::is_appimage,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
