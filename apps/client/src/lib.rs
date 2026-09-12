//! PlanWave Tauri 壳：窗口与本地通知。
//!
//! 数据层统一走前端 WASM 同步引擎（IndexedDB），各端（Windows/macOS/Linux/
//! Android/iOS）与 Web 共用同一套构建产物，壳本身不含任何存储逻辑。

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
