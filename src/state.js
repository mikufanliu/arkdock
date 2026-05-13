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
};

async function initState() {
    state.config = await invoke("load_config") || null;
    state.characters = await invoke("list_characters");
    if (state.characters.length > 0) {
        const spineChar = state.characters.find(c => c.model_type === "spine");
        await switchCharacter((spineChar || state.characters[0]).id);
    }
}

async function switchCharacter(charId) {
    state.currentChar = charId;
    state.chatHistory = await invoke("load_chat_history", { charId });

    const personaJson = await invoke("read_json_file", { charId, filename: "persona.json" });
    state.persona = personaJson ? JSON.parse(personaJson) : null;

    const skillsJson = await invoke("read_json_file", { charId, filename: "skills.json" });
    if (skillsJson) {
        const parsed = JSON.parse(skillsJson);
        state.skills = Array.isArray(parsed) ? parsed : (parsed.skills || []);
    } else {
        state.skills = [];
    }

    const voiceJson = await invoke("read_json_file", { charId, filename: "voice_lines.json" });
    if (voiceJson) {
        const parsed = JSON.parse(voiceJson);
        state.voiceLines = Array.isArray(parsed) ? parsed : (parsed.voiceLines || []);
    } else {
        state.voiceLines = [];
    }

    const manifest = await invoke("read_json_file", { charId, filename: "manifest.json" });
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

    // Default: first skin's first mode (after sorting, should be 默认 skin + front mode)
    let defaultMode = "default_front";
    if (manifestObj.skins && manifestObj.skins.length > 0) {
        const modes = manifestObj.skins[0].modes || [];
        defaultMode = (modes[0])?.path || defaultMode;
    } else if (manifestObj.defaultMode) {
        defaultMode = manifestObj.defaultMode;
    }

    if (manifestObj.type === "spine") {
        window.switchSpineModel(charId + "/" + defaultMode);
    } else if (manifestObj.type === "live2d") {
        window.switchLive2DModel(charId + "/" + defaultMode);
    } else if (manifestObj.type === "mmd") {
        window.switchMMDModel(charId + "/" + defaultMode);
    }
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
    }
}

async function saveConfig(config) {
    state.config = config;
    await invoke("save_config", { config });
}

async function saveChatHistory() {
    if (!state.currentChar) return;
    await invoke("save_chat_history", {
        charId: state.currentChar,
        messages: state.chatHistory,
    });
}
