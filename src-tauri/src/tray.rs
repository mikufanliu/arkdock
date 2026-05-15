use tauri::{
    AppHandle, Emitter,
    menu::{Menu, MenuItem, PredefinedMenuItem, CheckMenuItem},
    menu::SubmenuBuilder,
    tray::TrayIconBuilder,
    image::Image,
    Manager,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::fs;
use std::path::PathBuf;

static CLICK_THROUGH: AtomicBool = AtomicBool::new(false);

fn model_dir_for_tray() -> PathBuf {
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("web").join("model");
    if dev_path.exists() {
        return dev_path.canonicalize().unwrap_or(dev_path);
    }
    dev_path
}

#[derive(serde::Deserialize)]
struct Manifest {
    name: Option<String>,
    #[serde(rename = "type")]
    model_type: Option<String>,
    skins: Option<Vec<Skin>>,
}

#[derive(serde::Deserialize)]
struct Skin {
    name: Option<String>,
    modes: Option<Vec<Mode>>,
}

#[derive(serde::Deserialize)]
struct Mode {
    name: Option<String>,
    path: Option<String>,
}

pub fn create_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let click_through = CheckMenuItem::with_id(app, "click_through", "点击穿透", true, false, None::<&str>)?;

    // Build character switching submenu
    let model_menu = build_model_submenu(app)?;

    let clear_chat = MenuItem::with_id(app, "clear_chat", "清空对话", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[
        &show,
        &click_through,
        &PredefinedMenuItem::separator(app)?,
        &model_menu,
        &PredefinedMenuItem::separator(app)?,
        &clear_chat,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    let icon = Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .tooltip("ArkDock")
        .on_menu_event(|app, event| {
            let id = event.id.as_ref().to_string();
            match id.as_str() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            window.hide().ok();
                        } else {
                            window.show().ok();
                            window.set_focus().ok();
                        }
                    }
                }
                "click_through" => {
                    let new_val = !CLICK_THROUGH.load(Ordering::Relaxed);
                    CLICK_THROUGH.store(new_val, Ordering::Relaxed);
                    if let Some(window) = app.get_webview_window("main") {
                        window.set_ignore_cursor_events(new_val).ok();
                    }
                }
                "clear_chat" => {
                    app.emit("clear-chat", ()).ok();
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {
                    // Model switch handled by global on_menu_event in lib.rs
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn build_model_submenu(app: &AppHandle) -> Result<tauri::menu::Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    let model_dir = model_dir_for_tray();
    let mut builder = SubmenuBuilder::new(app, "切换模型");

    let mut entries: Vec<_> = fs::read_dir(&model_dir)?
        .flatten()
        .filter(|e| e.path().is_dir())
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let char_id = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if char_id.starts_with('.') || char_id == "icons" { continue; }

        let manifest_path = path.join("manifest.json");
        let data = match fs::read_to_string(&manifest_path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let manifest: Manifest = match serde_json::from_str(&data) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let _model_type = manifest.model_type.as_deref().unwrap_or("spine");
        // Include all model types in menu

        let char_name = manifest.name.as_deref().unwrap_or(&char_id);
        let skins = manifest.skins.unwrap_or_default();

        if skins.is_empty() {
            continue;
        }

        let is_single_skin = skins.len() == 1;
        let single_skin_modes = if is_single_skin { skins[0].modes.as_ref() } else { None };
        let is_single_mode = is_single_skin && single_skin_modes.map_or(true, |m| m.len() <= 1);

        if is_single_mode {
            // Single mode: just a button
            let mode_path = single_skin_modes
                .and_then(|m| m.first())
                .and_then(|m| m.path.as_deref())
                .unwrap_or(".");
            let model_id = if mode_path == "." {
                format!("model:{}", char_id)
            } else {
                format!("model:{}/{}", char_id, mode_path)
            };
            let item = MenuItem::with_id(app, &model_id, char_name, true, None::<&str>)?;
            builder = builder.item(&item);
        } else if is_single_skin {
            // Single skin, multiple modes: char_name -> [modes]
            let mut sub = SubmenuBuilder::new(app, char_name);
            for mode in single_skin_modes.unwrap_or(&vec![]) {
                let mode_path = mode.path.as_deref().unwrap_or(".");
                let mode_name = mode.name.as_deref().unwrap_or(mode_path);
                let model_id = format!("model:{}/{}", char_id, mode_path);
                let item = MenuItem::with_id(app, &model_id, mode_name, true, None::<&str>)?;
                sub = sub.item(&item);
            }
            let sub_menu = sub.build()?;
            builder = builder.item(&sub_menu);
        } else {
            // Multiple skins: char_name -> skin_name -> [modes]
            let mut char_sub = SubmenuBuilder::new(app, char_name);
            for skin in &skins {
                let skin_name = skin.name.as_deref().unwrap_or("默认");
                let modes = skin.modes.as_ref().map(|m| m.as_slice()).unwrap_or(&[]);
                if modes.len() <= 1 {
                    let mode_path = modes.first().and_then(|m| m.path.as_deref()).unwrap_or(".");
                    let model_id = format!("model:{}/{}", char_id, mode_path);
                    let item = MenuItem::with_id(app, &model_id, skin_name, true, None::<&str>)?;
                    char_sub = char_sub.item(&item);
                } else {
                    let mut skin_sub = SubmenuBuilder::new(app, skin_name);
                    for mode in modes {
                        let mode_path = mode.path.as_deref().unwrap_or(".");
                        let mode_name = mode.name.as_deref().unwrap_or(mode_path);
                        let model_id = format!("model:{}/{}", char_id, mode_path);
                        let item = MenuItem::with_id(app, &model_id, mode_name, true, None::<&str>)?;
                        skin_sub = skin_sub.item(&item);
                    }
                    let skin_menu = skin_sub.build()?;
                    char_sub = char_sub.item(&skin_menu);
                }
            }
            let char_menu = char_sub.build()?;
            builder = builder.item(&char_menu);
        }
    }

    Ok(builder.build()?)
}
