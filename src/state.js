const { invoke } = window.__TAURI__.core;
const { emit, listen } = window.__TAURI__.event;
const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;

const state = {
    currentChar: null,
    characters: [],
    config: null,
    chatHistory: [],
    skills: [],
    voiceLines: {},
    persona: null,
    manifest: null,
    currentSkinIndex: 0,
    currentModeIndex: 0,
    voiceLang: "cn",
    userScale: 1.0,
    modeScales: {},
    globalPrefs: {},
    switchToken: 0,
};

async function initState() {
    state.config = await invoke("load_config") || null;
    state.characters = await invoke("list_characters");

    // Load global prefs (last character, lastSeenTs, etc.)
    const globalPrefs = await invoke("load_char_prefs", { charId: "_global" });
    state.globalPrefs = globalPrefs || {};
    const lastChar = globalPrefs && globalPrefs.lastChar;

    if (state.characters.length > 0) {
        const target = lastChar && state.characters.find(c => c.id === lastChar);
        const fallback = state.characters.find(c => c.model_type === "spine") || state.characters[0];
        await switchCharacter((target || fallback).id);
    }
}

async function switchCharacter(charId, preferredModePath = null) {
    const token = ++state.switchToken;

    state.currentChar = charId;
    state.chatHistory = await invoke("load_chat_history", { charId });
    if (token !== state.switchToken) return;

    // Load per-character preferences (modeScales, voiceLang)
    const prefs = await invoke("load_char_prefs", { charId });
    if (token !== state.switchToken) return;
    if (prefs) {
        state.modeScales = prefs.modeScales || {};
        if (prefs.voiceLang) state.voiceLang = prefs.voiceLang;
    } else {
        state.modeScales = {};
    }

    const personaJson = await invoke("read_json_file", { charId, filename: "persona.json" });
    if (token !== state.switchToken) return;
    state.persona = personaJson ? JSON.parse(personaJson) : null;

    const skillsJson = await invoke("read_json_file", { charId, filename: "skills.json" });
    if (token !== state.switchToken) return;
    if (skillsJson) {
        const parsed = JSON.parse(skillsJson);
        state.skills = Array.isArray(parsed) ? parsed : (parsed.skills || []);
    } else {
        state.skills = [];
    }

    const voiceJson = await invoke("read_json_file", { charId, filename: "voice_lines.json" });
    if (token !== state.switchToken) return;
    if (voiceJson) {
        const parsed = JSON.parse(voiceJson);
        state.voiceLines = Array.isArray(parsed) ? parsed : (parsed.voiceLines || []);
    } else {
        state.voiceLines = [];
    }

    const manifest = await invoke("read_json_file", { charId, filename: "manifest.json" });
    if (token !== state.switchToken) return;
    const manifestObj = manifest ? JSON.parse(manifest) : {};

    // Normalize: sort skins (默认 first) and modes (front → build → back)
    if (manifestObj.skins) {
        manifestObj.skins.sort((a, b) => {
            if (a.name === "默认") return -1;
            if (b.name === "默认") return 1;
            return 0;
        });
        const modeOrder = (path) => {
            if (!path) return 9;
            if (path.includes("front") || path.includes("battle")) return 0;
            if (path.includes("build")) return 1;
            if (path.includes("back")) return 2;
            return 9;
        };
        for (const skin of manifestObj.skins) {
            if (skin.modes) {
                skin.modes.sort((a, b) => modeOrder(a.path) - modeOrder(b.path));
            }
        }
    }

    state.manifest = manifestObj;
    state.currentSkinIndex = 0;
    state.currentModeIndex = 0;

    // Resolve target mode:
    // 1) explicit preferred mode from switch-model payload
    // 2) character default mode
    let resolvedMode = null;
    if (preferredModePath && manifestObj.skins) {
        let found = false;
        for (let si = 0; si < manifestObj.skins.length; si++) {
            const modes = manifestObj.skins[si].modes || [];
            for (let mi = 0; mi < modes.length; mi++) {
                if (modes[mi].path === preferredModePath) {
                    state.currentSkinIndex = si;
                    state.currentModeIndex = mi;
                    resolvedMode = preferredModePath;
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
    }

    if (!resolvedMode) {
        let defaultMode = "default_front";
        if (manifestObj.skins && manifestObj.skins.length > 0) {
            const modes = manifestObj.skins[0].modes || [];
            defaultMode = (modes[0])?.path || defaultMode;
        } else if (manifestObj.defaultMode) {
            defaultMode = manifestObj.defaultMode;
        }
        resolvedMode = defaultMode;
    }

    // Set scale BEFORE loading model so fitSpine uses correct value immediately
    const modePath = resolvedMode;
    state.userScale = getScaleForMode(modePath);
    if (window.setUserScale) window.setUserScale(state.userScale);

    if (manifestObj.type === "spine") {
        window.switchSpineModel(charId + "/" + defaultMode);
    } else if (manifestObj.type === "live2d") {
        window.switchLive2DModel(charId + "/" + defaultMode);
    } else if (manifestObj.type === "mmd") {
        window.switchMMDModel(charId + "/" + defaultMode);
    }

    saveGlobalPrefs();
}

function switchToMode(skinIndex, modeIndex) {
    const manifest = state.manifest;
    if (!manifest || !manifest.skins) return;
    const skin = manifest.skins[skinIndex];
    if (!skin) return;
    const mode = skin.modes[modeIndex];
    if (!mode) return;

    state.currentSkinIndex = skinIndex;
    state.currentModeIndex = modeIndex;

    if (manifest.type === "spine") {
        window.switchSpineModel(state.currentChar + "/" + mode.path);
    } else if (manifest.type === "live2d") {
        window.switchLive2DModel(state.currentChar + "/" + mode.path);
    } else if (manifest.type === "mmd") {
        window.switchMMDModel(state.currentChar + "/" + mode.path);
    }

    // Apply this mode's scale
    state.userScale = getScaleForMode(mode.path);
    setTimeout(() => {
        if (manifest.type === "mmd") {
            if (window.mmdSetScale) window.mmdSetScale(state.userScale);
        } else {
            if (window.setUserScale) window.setUserScale(state.userScale);
        }
    }, 300);
}

async function saveConfig(config) {
    state.config = config;
    await invoke("save_config", { config });
}

function getCurrentModePath() {
    const manifest = state.manifest;
    if (!manifest || !manifest.skins) return "default_front";
    const skin = manifest.skins[state.currentSkinIndex];
    if (!skin || !skin.modes) return "default_front";
    const mode = skin.modes[state.currentModeIndex];
    return mode ? mode.path : "default_front";
}

function getScaleForMode(modePath) {
    if (state.modeScales[modePath] != null) return state.modeScales[modePath];
    const manifest = state.manifest;
    if (manifest && manifest.defaultScales && manifest.defaultScales[modePath] != null) {
        return manifest.defaultScales[modePath];
    }
    return 1.0;
}

async function saveCharPrefs() {
    if (!state.currentChar) return;
    const modePath = getCurrentModePath();
    state.modeScales[modePath] = state.userScale;
    await invoke("save_char_prefs", {
        charId: state.currentChar,
        prefs: { modeScales: state.modeScales, voiceLang: state.voiceLang },
    });
}

async function saveGlobalPrefs() {
    await invoke("save_char_prefs", {
        charId: "_global",
        prefs: { lastChar: state.currentChar, lastSeenTs: Date.now() },
    });
}

async function saveChatHistory() {
    if (!state.currentChar) return;
    await invoke("save_chat_history", {
        charId: state.currentChar,
        messages: state.chatHistory,
    });
}
