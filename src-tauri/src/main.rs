#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod tray;

use tauri::{Emitter, Manager};
use tauri::webview::Color;
use std::fs;
use std::path::PathBuf;

fn window_prefs_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from(".")).join("prefs");
    fs::create_dir_all(&dir).ok();
    dir.join("_window.json")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if let Err(err) = tray::create_tray(app.handle()) {
                eprintln!("failed to create tray: {err}");
            }
            if let Some(window) = app.get_webview_window("main") {
                window.set_ignore_cursor_events(false).ok();
                window.set_background_color(Some(Color(0, 0, 0, 0))).ok();
                #[cfg(target_os = "windows")]
                {
                    // Transparent undecorated windows on Windows can show a halo/white border
                    // due to DWM shadow/composition. Disable native shadow explicitly.
                    window.set_shadow(false).ok();
                }

                // Restore saved window position (with screen bounds check)
                let path = window_prefs_path(app.handle());
                if let Ok(data) = fs::read_to_string(&path) {
                    if let Ok(pos) = serde_json::from_str::<serde_json::Value>(&data) {
                        if let (Some(x), Some(y)) = (pos["x"].as_f64(), pos["y"].as_f64()) {
                            use tauri::PhysicalPosition;
                            let mut on_screen = false;
                            if let Ok(monitors) = window.available_monitors() {
                                for m in monitors {
                                    let mp = m.position();
                                    let ms = m.size();
                                    let right = mp.x + ms.width as i32;
                                    let bottom = mp.y + ms.height as i32;
                                    let xi = x as i32;
                                    let yi = y as i32;
                                    if xi >= mp.x - 200 && xi < right && yi >= mp.y - 200 && yi < bottom {
                                        on_screen = true;
                                        break;
                                    }
                                }
                            }
                            if on_screen {
                                window.set_position(PhysicalPosition::new(x as i32, y as i32)).ok();
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .on_window_event(|app, event| {
            if let tauri::WindowEvent::Moved(pos) = event {
                let path = window_prefs_path(app.app_handle());
                let json = format!("{{\"x\":{},\"y\":{}}}", pos.x, pos.y);
                fs::write(path, json).ok();
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            if let Some(model_id) = id.strip_prefix("model:") {
                app.emit("switch-model", model_id.to_string()).ok();
            } else if let Some(motion) = id.strip_prefix("ctx_motion:") {
                app.emit("play-motion", motion.to_string()).ok();
            } else if let Some(scale_str) = id.strip_prefix("ctx_scale:") {
                if let Ok(pct) = scale_str.parse::<u32>() {
                    let scale = pct as f64 / 100.0;
                    app.emit("set-scale", scale).ok();
                }
            } else if id == "ctx_flip" {
                app.emit("flip-model", ()).ok();
            } else if id == "ctx_clear" {
                app.emit("clear-chat", ()).ok();
            } else if id == "ctx_quit" {
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_characters,
            commands::read_json_file,
            commands::list_model_files,
            commands::save_config,
            commands::load_config,
            commands::save_char_prefs,
            commands::load_char_prefs,
            commands::save_chat_history,
            commands::load_chat_history,
            commands::play_audio,
            commands::get_model_base_url,
            commands::show_context_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
