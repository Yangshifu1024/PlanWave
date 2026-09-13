//! PlanWave Tauri 壳：窗口、本地通知、系统托盘与应用自动更新。
//!
//! 数据层统一走前端 WASM 同步引擎（IndexedDB），各端（Windows/macOS/Linux/
//! Android/iOS）与 Web 共用同一套构建产物，壳本身不含任何存储逻辑。
//!
//! 窗口管理（仅桌面）：
//! - 托盘：Windows/macOS 启用；左键单击切换主窗口显隐，右键菜单仅「退出」；
//! - 关闭语义：Windows 关闭 = 隐藏到托盘（退出仅经托盘菜单）；
//!   macOS/Linux 保持原生关闭行为（关闭 = 关窗，Linux 下即退出）。

#[cfg(desktop)]
mod proxied_http;
mod update_apk;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 关闭 = 隐藏到托盘；真正退出走托盘菜单「退出」
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = (window, event);
            }
        })
        .setup(|app| {
            // Linux 桌面托盘支持参差（GNOME 需 AppIndicator 扩展），不启用
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            setup_tray(app)?;
            Ok(())
        });

    // 命令注册必须一次完成（invoke_handler 是整体替换，不可拆分调用）
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        update_apk::download_update_apk,
        update_apk::install_update_apk,
        update_apk::is_appimage,
        proxied_http::http_request,
        proxied_http::test_proxy,
        proxied_http::system_proxy_url,
    ]);
    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        update_apk::download_update_apk,
        update_apk::install_update_apk,
        update_apk::is_appimage,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 构建 tray 图标与菜单（仅 Windows/macOS）。
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().expect("缺少应用图标").clone())
        .tooltip("PlanWave")
        .menu(&menu)
        // 左键用于切换窗口显隐，菜单只在右键弹出
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            if event.id() == "quit" {
                app.exit(0);
            }
        })
        .build(app)?;
    Ok(())
}

/// 托盘左键：切换主窗口显隐（显示时置顶聚焦）。
#[cfg(any(target_os = "windows", target_os = "macos"))]
fn toggle_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    match app.get_webview_window("main") {
        Some(window) => {
            // Windows 上最小化的窗口 is_visible 仍为 true：先还原再聚焦，
            // 否则托盘点击会把最小化窗口「隐藏」而不是还原
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            } else if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        None => rebuild_destroyed_window(app),
    }
}

/// macOS 红钮关闭会销毁窗口：此时按 label 找到配置重建后再显示。
#[cfg(target_os = "macos")]
fn rebuild_destroyed_window(app: &tauri::AppHandle) {
    let config = app.config();
    let window_config = config.app.windows.iter().find(|w| w.label == "main");
    if let Some(window_config) = window_config {
        if let Err(e) = tauri::WebviewWindowBuilder::from_config(app, window_config)
            .and_then(|builder| builder.build())
            .map(|window| {
                let _ = window.show();
                let _ = window.set_focus();
            })
        {
            eprintln!("重建主窗口失败: {e}");
        }
    }
}

#[cfg(all(
    any(target_os = "windows", target_os = "macos"),
    not(target_os = "macos")
))]
fn rebuild_destroyed_window(_app: &tauri::AppHandle) {}
