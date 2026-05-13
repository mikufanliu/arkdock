use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};

static AUDIO_GENERATION: AtomicU64 = AtomicU64::new(0);

fn model_dir(app: &AppHandle) -> PathBuf {
    let resource = app.path().resource_dir().unwrap_or_default().join("web").join("model");
    if resource.exists() {
        return resource;
    }
    // Dev mode: model files are in the project's web/model directory
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("web").join("model");
    if dev_path.exists() {
        return dev_path.canonicalize().unwrap_or(dev_path);
    }
    resource
}

fn data_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[derive(Serialize)]
pub struct CharacterInfo {
    pub id: String,
    pub name: String,
    pub model_type: String,
}

#[tauri::command]
pub fn list_characters(app: AppHandle) -> Vec<CharacterInfo> {
    let dir = model_dir(&app);
    let mut chars = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return chars,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let id = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        if id.starts_with('.') { continue; }
        let manifest_path = path.join("manifest.json");
        if let Ok(data) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&data) {
                let name = manifest["name"].as_str().unwrap_or(&id).to_string();
                let model_type = manifest["type"].as_str().unwrap_or("spine").to_string();
                chars.push(CharacterInfo { id, name, model_type });
            }
        }
    }
    chars.sort_by(|a, b| a.id.cmp(&b.id));
    chars
}

#[tauri::command]
pub fn read_json_file(app: AppHandle, char_id: String, filename: String) -> Option<String> {
    let path = model_dir(&app).join(&char_id).join(&filename);
    fs::read_to_string(path).ok()
}

#[tauri::command]
pub fn list_model_files(app: AppHandle, char_id: String, sub_path: String) -> Vec<String> {
    let dir = model_dir(&app).join(&char_id).join(&sub_path);
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if e.path().is_file() { Some(name) } else { None }
        })
        .collect()
}

#[derive(Serialize, Deserialize)]
pub struct LLMConfig {
    pub provider: String,
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: LLMConfig) -> Result<(), String> {
    let dir = data_dir(&app);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> Option<LLMConfig> {
    let path = data_dir(&app).join("config.json");
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

#[derive(Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub fn save_chat_history(app: AppHandle, char_id: String, messages: Vec<ChatMessage>) -> Result<(), String> {
    let dir = data_dir(&app).join("history");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", char_id));
    let data = serde_json::to_string(&messages).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_chat_history(app: AppHandle, char_id: String) -> Vec<ChatMessage> {
    let path = data_dir(&app).join("history").join(format!("{}.json", char_id));
    let data = match fs::read_to_string(path) {
        Ok(d) => d,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str(&data).unwrap_or_default()
}

#[tauri::command]
pub fn play_audio(app: AppHandle, char_id: String, file: String, lang: Option<String>) -> Result<(), String> {
    let voice_lang = lang.unwrap_or_else(|| "cn".to_string());
    let path = model_dir(&app).join(&char_id).join("voice").join(&voice_lang).join(&file);
    // Fallback to flat voice/ directory for legacy layout
    let path = if path.exists() { path } else {
        model_dir(&app).join(&char_id).join("voice").join(&file)
    };
    if !path.exists() {
        return Err(format!("Audio file not found: {}", path.display()));
    }

    let gen = AUDIO_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    std::thread::spawn(move || {
        let file = match fs::File::open(&path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let reader = std::io::BufReader::new(file);
        let (_stream, handle) = match rodio::OutputStream::try_default() {
            Ok(s) => s,
            Err(_) => return,
        };
        let sink = match rodio::Sink::try_new(&handle) {
            Ok(s) => s,
            Err(_) => return,
        };
        if let Ok(source) = rodio::Decoder::new(reader) {
            sink.append(source);
            while !sink.empty() {
                if AUDIO_GENERATION.load(Ordering::SeqCst) != gen {
                    sink.stop();
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn get_model_base_url(app: AppHandle) -> String {
    let dir = model_dir(&app);
    format!("file://{}", dir.display())
}

#[derive(Deserialize)]
struct ManifestData {
    name: Option<String>,
    #[serde(rename = "type")]
    model_type: Option<String>,
    skins: Option<Vec<SkinData>>,
}

#[derive(Deserialize)]
struct SkinData {
    name: Option<String>,
    modes: Option<Vec<ModeData>>,
}

#[derive(Deserialize)]
struct ModeData {
    name: Option<String>,
    path: Option<String>,
}

#[tauri::command]
pub fn show_context_menu(app: AppHandle, motions: Vec<String>) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no window")?;

    // Build model switching submenu
    let model_sub = build_context_model_submenu(&app).map_err(|e| e.to_string())?;

    // Build motions submenu
    let mut motion_builder = SubmenuBuilder::new(&app, "动作");
    for name in &motions {
        let id = format!("ctx_motion:{}", name);
        let item = MenuItem::with_id(&app, &id, name.as_str(), true, None::<&str>)
            .map_err(|e| e.to_string())?;
        motion_builder = motion_builder.item(&item);
    }
    let motion_sub = motion_builder.build().map_err(|e| e.to_string())?;

    // Scale submenu
    let mut scale_builder = SubmenuBuilder::new(&app, "缩放");
    for pct in [50, 75, 100, 125, 150] {
        let id = format!("ctx_scale:{}", pct);
        let label = format!("{}%", pct);
        let item = MenuItem::with_id(&app, &id, &label, true, None::<&str>)
            .map_err(|e| e.to_string())?;
        scale_builder = scale_builder.item(&item);
    }
    let scale_sub = scale_builder.build().map_err(|e| e.to_string())?;

    let flip = MenuItem::with_id(&app, "ctx_flip", "翻转方向", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let clear = MenuItem::with_id(&app, "ctx_clear", "清空对话", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&app, "ctx_quit", "退出", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let sep1 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let sep3 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(&app, &[
        &model_sub,
        &motion_sub,
        &sep1,
        &flip,
        &scale_sub,
        &sep2,
        &clear,
        &sep3,
        &quit,
    ]).map_err(|e| e.to_string())?;

    window.popup_menu(&menu).map_err(|e| e.to_string())?;
    Ok(())
}

fn build_context_model_submenu(app: &AppHandle) -> Result<tauri::menu::Submenu<tauri::Wry>, Box<dyn std::error::Error>> {
    let dir = model_dir(app);
    let mut builder = SubmenuBuilder::new(app, "切换模型");

    let mut entries: Vec<_> = fs::read_dir(&dir)?
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
        let manifest: ManifestData = match serde_json::from_str(&data) {
            Ok(m) => m,
            Err(_) => continue,
        };

        let _model_type = manifest.model_type.as_deref().unwrap_or("spine");

        let char_name = manifest.name.as_deref().unwrap_or(&char_id);
        let skins = manifest.skins.unwrap_or_default();
        if skins.is_empty() { continue; }

        let is_single_skin = skins.len() == 1;
        let single_skin_modes = if is_single_skin { skins[0].modes.as_ref() } else { None };
        let is_single_mode = is_single_skin && single_skin_modes.map_or(true, |m| m.len() <= 1);

        if is_single_mode {
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
            let mut sub = SubmenuBuilder::new(app, char_name);
            for mode in single_skin_modes.unwrap_or(&vec![]) {
                let mode_path = mode.path.as_deref().unwrap_or(".");
                let mode_name = mode.name.as_deref().unwrap_or(mode_path);
                let model_id = format!("model:{}/{}", char_id, mode_path);
                let item = MenuItem::with_id(app, &model_id, mode_name, true, None::<&str>)?;
                sub = sub.item(&item);
            }
            builder = builder.item(&sub.build()?);
        } else {
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
                    char_sub = char_sub.item(&skin_sub.build()?);
                }
            }
            builder = builder.item(&char_sub.build()?);
        }
    }

    Ok(builder.build()?)
}
