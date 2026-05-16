const appWindow = getCurrentWebviewWindow();
const { LogicalSize } = window.__TAURI__.dpi;

let bubbleTimer = null;
let idleChatTimer = null;
let currentTab = "archive";
let motionGroups = {};
let modelExpressions = [];
let activeVoiceAudio = null;

function buildVoiceFallbackUrls(audioFile) {
    if (!audioFile || !state.currentChar) return [];
    const raw = String(audioFile).replace(/^\/+/, "");
    const urls = [];
    if (raw.includes("/")) {
        urls.push(`/web/model/${state.currentChar}/${raw}`);
        return urls;
    }

    const langOrder = [];
    const seen = new Set();
    [state.voiceLang, "cn", "jp", "dialect"].forEach((lang) => {
        if (!lang || seen.has(lang)) return;
        seen.add(lang);
        langOrder.push(lang);
    });
    langOrder.forEach((lang) => {
        urls.push(`/web/model/${state.currentChar}/voice/${lang}/${raw}`);
    });
    urls.push(`/web/model/${state.currentChar}/voice/${raw}`);
    return urls;
}

async function playVoiceFallback(audioFile) {
    const urls = buildVoiceFallbackUrls(audioFile);
    for (const url of urls) {
        try {
            const audio = new Audio(url);
            audio.preload = "auto";
            if (activeVoiceAudio) {
                activeVoiceAudio.pause();
                activeVoiceAudio.currentTime = 0;
            }
            await audio.play();
            activeVoiceAudio = audio;
            return true;
        } catch (_) {
            // try next candidate
        }
    }
    return false;
}

function playVoiceFile(audioFile) {
    if (!audioFile || !state.currentChar) return;
    invoke("play_audio", { charId: state.currentChar, file: audioFile, lang: state.voiceLang })
        .catch(async (e) => {
            console.error("play_audio:", e);
            const fallbackOk = await playVoiceFallback(audioFile);
            if (!fallbackOk) {
                showBubble("音频不可用，请检查系统输出设备", 2500);
            }
        });
}

// === 气泡 ===

function showBubble(text, duration = 5000) {
    const bubble = document.getElementById("bubble");
    const bubbleText = document.getElementById("bubble-text");
    bubbleText.textContent = text;
    bubble.classList.remove("hidden");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.add("hidden"), duration);
}

function hideBubble() {
    document.getElementById("bubble").classList.add("hidden");
    clearTimeout(bubbleTimer);
}

// === 输入框 ===

function toggleInput() {
    const area = document.getElementById("input-area");
    if (area.classList.contains("hidden")) {
        area.classList.remove("hidden");
        document.getElementById("chat-input").focus();
    } else {
        hideInput();
    }
}

function hideInput() {
    document.getElementById("input-area").classList.add("hidden");
}

// === 技能栏 ===

function renderSkillBar() {
    const bar = document.getElementById("skill-bar");
    bar.innerHTML = "";
    if (!state.skills || state.skills.length === 0) return;
    // Only show skills in battle mode (front/battle, not build/back)
    const manifest = state.manifest;
    if (manifest && manifest.skins) {
        const skin = manifest.skins[state.currentSkinIndex];
        const mode = skin && skin.modes && skin.modes[state.currentModeIndex];
        if (mode && mode.path && (mode.path.includes("build") || mode.path.includes("back"))) return;
    }

    state.skills.forEach((skill) => {
        const btn = document.createElement("button");
        btn.className = "skill-btn";
        btn.title = skill.description || skill.name || "";
        if (skill.icon) {
            const img = document.createElement("img");
            img.src = `/web/model/${state.currentChar}/${skill.icon}`;
            btn.appendChild(img);
        }
        const nameEl = document.createElement("span");
        nameEl.className = "skill-name";
        nameEl.textContent = skill.name || "";
        btn.appendChild(nameEl);
        btn.addEventListener("click", () => activateSkill(skill));
        bar.appendChild(btn);
    });
}

function activateSkill(skill) {
    if (skill.animation) {
        window.playMotion(skill.animation, 0);
    }
    if (skill.voiceLine) {
        showBubble(skill.voiceLine, 4000);
        const audioFile = skill.audioFile || skill.voiceFile;
        playVoiceFile(audioFile);
    } else if (skill.name) {
        showBubble(skill.name, 2000);
    }
}

// === 侧边面板（窗口右扩）===

async function toggleActionPanel() {
    const panel = document.getElementById("action-panel");
    const btn = document.getElementById("panel-toggle");
    const isOpening = panel.classList.contains("hidden");

    if (isOpening) {
        // Expand window first, then slide panel in
        await appWindow.setSize(new LogicalSize(470, 500));
        requestAnimationFrame(() => {
            panel.classList.remove("hidden");
        });
        btn.classList.add("active");
        btn.textContent = "›";
        renderPanelContent();
    } else {
        // Slide panel out, then shrink window
        panel.classList.add("hidden");
        btn.classList.remove("active");
        btn.textContent = "🎭";
        setTimeout(async () => {
            await appWindow.setSize(new LogicalSize(350, 500));
        }, 260);
    }
}

function renderPanelContent() {
    const content = document.getElementById("panel-content");
    content.innerHTML = "";
    if (currentTab === "archive") renderArchiveTab(content);
    else if (currentTab === "motions") renderMotionsTab(content);
    else if (currentTab === "voice") renderVoiceTab(content);
    else if (currentTab === "settings") renderSettingsTab(content);
}

// === 档案 Tab ===

function renderArchiveTab(container) {
    if (!state.persona) {
        container.innerHTML = '<div class="action-item">无档案数据</div>';
        return;
    }

    // Header: 职业图标 + 名字
    const header = document.createElement("div");
    header.className = "archive-header";
    if (state.persona.profession) {
        const profIcon = document.createElement("img");
        profIcon.src = `/web/model/icons/prof_${state.persona.profession}.png`;
        profIcon.onerror = () => profIcon.style.display = "none";
        header.appendChild(profIcon);
    }
    const name = document.createElement("span");
    name.className = "char-name";
    name.textContent = state.persona.name || state.currentChar;
    header.appendChild(name);
    container.appendChild(header);

    // Sub: 子分支图标 + 文字
    if (state.persona.subProfession || state.persona.profession) {
        const sub = document.createElement("div");
        sub.className = "archive-sub";
        if (state.persona.subProfession) {
            const subIcon = document.createElement("img");
            subIcon.src = `/web/model/icons/sub_${state.persona.subProfession}.png`;
            subIcon.onerror = () => subIcon.style.display = "none";
            sub.appendChild(subIcon);
            const subText = document.createElement("span");
            subText.textContent = state.persona.subProfession;
            sub.appendChild(subText);
        }
        if (state.persona.profession) {
            const profText = document.createElement("span");
            profText.textContent = state.persona.profession;
            sub.appendChild(profText);
        }
        container.appendChild(sub);
    }

    // 信赖条
    const trust = document.createElement("div");
    trust.className = "archive-trust";
    trust.innerHTML = `<span style="color:#ff6b8a">♥</span><span>信赖</span><div class="bar"><div class="bar-fill" style="width:50%"></div></div><span style="color:#007aff;font-weight:500">50%</span>`;
    container.appendChild(trust);

    // 档案
    const archives = state.persona.archives || [];
    if (archives.length === 0) return;

    const nav = document.createElement("div");
    nav.className = "archive-nav";

    const textEl = document.createElement("div");
    textEl.className = "archive-text";
    textEl.textContent = archives[0].content || "";

    const titleSpan = document.createElement("span");
    titleSpan.className = "archive-title";
    titleSpan.textContent = archives[0].title || "";

    archives.forEach((arch, i) => {
        const btn = document.createElement("button");
        btn.textContent = i + 1;
        if (i === 0) btn.className = "active";
        btn.addEventListener("click", () => {
            nav.querySelectorAll("button").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            textEl.textContent = arch.content || "";
            titleSpan.textContent = arch.title || "";
        });
        nav.appendChild(btn);
    });
    nav.appendChild(titleSpan);
    container.appendChild(nav);
    container.appendChild(textEl);
}

// === 动作 Tab（动画列表）===

function renderMotionsTab(container) {
    const groups = Object.keys(motionGroups).sort();
    const isLive2D = state.manifest && state.manifest.type === "live2d";
    const isMMD = state.manifest && state.manifest.type === "mmd";

    if (groups.length === 0 && modelExpressions.length === 0) {
        container.innerHTML = '<div class="action-item">无动作数据</div>';
        return;
    }

    // Motions
    if (groups.length > 0) {
        groups.forEach(group => {
            const count = motionGroups[group];
            if (isLive2D && count > 1) {
                for (let i = 0; i < count; i++) {
                    const item = document.createElement("div");
                    item.className = "action-item";
                    item.textContent = `${group} ${i + 1}`;
                    item.addEventListener("click", () => window.live2dPlayMotion(group, i));
                    container.appendChild(item);
                }
            } else {
                const item = document.createElement("div");
                item.className = "action-item";
                item.textContent = group || "默认";
                if (isLive2D) {
                    item.addEventListener("click", () => window.live2dPlayMotion(group, 0));
                } else if (isMMD) {
                    item.addEventListener("click", () => window.mmdPlayMotion(group));
                } else {
                    item.addEventListener("click", () => window.playMotion(group, 0));
                }
                container.appendChild(item);
            }
        });
    }

    // Expressions (Live2D)
    if (isLive2D && modelExpressions.length > 0) {
        const label = document.createElement("div");
        label.className = "action-item";
        label.style.opacity = "0.5";
        label.style.fontSize = "9px";
        label.textContent = "— 表情 —";
        container.appendChild(label);

        modelExpressions.forEach(name => {
            const item = document.createElement("div");
            item.className = "action-item";
            item.textContent = name;
            item.addEventListener("click", () => window.live2dSetExpression(name));
            container.appendChild(item);
        });
    }
}

// === 语音 Tab ===

function renderVoiceTab(container) {
    // Language switcher
    const langBar = document.createElement("div");
    langBar.className = "voice-lang-bar";
    const langs = [
        { id: "cn", label: "中文" },
        { id: "jp", label: "日本語" },
        { id: "dialect", label: "方言" },
    ];
    langs.forEach(l => {
        const btn = document.createElement("button");
        btn.className = "voice-lang-btn" + (state.voiceLang === l.id ? " active" : "");
        btn.textContent = l.label;
        btn.addEventListener("click", () => {
            state.voiceLang = l.id;
            saveCharPrefs();
            renderVoiceTab(container);
        });
        langBar.appendChild(btn);
    });
    container.innerHTML = "";
    container.appendChild(langBar);

    const lines = state.voiceLines;
    if (!lines || lines.length === 0) {
        container.innerHTML += '<div class="action-item">无语音数据</div>';
        return;
    }
    lines.forEach(line => {
        const item = document.createElement("div");
        item.className = "action-item";
        item.textContent = line.title || line.content || line.key;
        item.addEventListener("click", () => {
            if (line.content) showBubble(line.content, 4000);
            playVoiceFile(line.audioFile);
        });
        container.appendChild(item);
    });
}

// === 设置 Tab ===

function renderSettingsTab(container) {
    const form = document.createElement("div");
    form.className = "settings-form";

    const config = state.config || {};
    form.innerHTML = `
        <label>角色</label>
        <select id="char-select"></select>
        <label>Provider</label>
        <select id="llm-provider">
            <option value="openai" ${config.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            <option value="deepseek" ${config.provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
            <option value="kimi" ${config.provider === 'kimi' ? 'selected' : ''}>Kimi (Moonshot)</option>
            <option value="anthropic" ${config.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
            <option value="custom" ${config.provider === 'custom' ? 'selected' : ''}>自定义</option>
        </select>
        <label>Endpoint</label>
        <input type="text" id="llm-endpoint" value="${config.endpoint || ''}" placeholder="https://api.openai.com">
        <label>API Key</label>
        <input type="password" id="llm-apikey" value="${config.api_key || ''}" placeholder="sk-...">
        <label>Model</label>
        <input type="text" id="llm-model" value="${config.model || ''}" placeholder="gpt-4o-mini">
        <label>缩放</label>
        <input type="range" id="scale-slider" min="0.1" max="5.0" step="0.05" value="${state.userScale || 1.0}">
        <button class="btn-save" id="save-settings">保存</button>
    `;
    container.appendChild(form);

    // Populate char select after DOM is in
    setTimeout(() => {
        const select = document.getElementById("char-select");
        if (!select) return;
        state.characters.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.id;
            const typeLabel = c.model_type !== "spine" ? ` [${c.model_type}]` : "";
            opt.textContent = c.name + typeLabel;
            if (c.id === state.currentChar) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener("change", async (e) => {
            await switchCharacter(e.target.value);
            renderSkillBar();
            startIdleChat();
            renderPanelContent();
        });
        document.getElementById("scale-slider").addEventListener("input", (e) => {
            const scale = parseFloat(e.target.value);
            state.userScale = scale;
            saveCharPrefs();
            if (state.manifest && state.manifest.type === "mmd") {
                if (window.mmdSetScale) window.mmdSetScale(scale);
            } else {
                window.setUserScale(scale);
            }
        });
        document.getElementById("llm-provider").addEventListener("change", (e) => {
            const presets = {
                openai: { endpoint: "https://api.openai.com", model: "gpt-4o-mini" },
                deepseek: { endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
                kimi: { endpoint: "https://api.moonshot.cn", model: "moonshot-v1-8k" },
                anthropic: { endpoint: "https://api.anthropic.com", model: "claude-sonnet-4-20250514" },
                custom: { endpoint: "", model: "" },
            };
            const preset = presets[e.target.value];
            if (preset) {
                document.getElementById("llm-endpoint").value = preset.endpoint;
                document.getElementById("llm-model").value = preset.model;
            }
        });
        document.getElementById("save-settings").addEventListener("click", async () => {
            await saveConfig({
                provider: document.getElementById("llm-provider").value,
                endpoint: document.getElementById("llm-endpoint").value,
                api_key: document.getElementById("llm-apikey").value,
                model: document.getElementById("llm-model").value,
            });
        });
    }, 0);
}

// === 闲置聊天 ===

function startIdleChat() {
    stopIdleChat();
    scheduleIdleChat();
}

function stopIdleChat() {
    clearTimeout(idleChatTimer);
    idleChatTimer = null;
}

function scheduleIdleChat() {
    const delay = 30000 + Math.random() * 60000;
    idleChatTimer = setTimeout(() => {
        const text = (typeof getIdleLine === "function") ? getIdleLine() : scriptedReply();
        if (text && text !== "……") showBubble(text, 5000);
        scheduleIdleChat();
    }, delay);
}

// === Event Listeners ===

document.getElementById("send-btn").addEventListener("click", async () => {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    hideInput();
    const reply = await sendMessage(text);
    if (reply) showBubble(reply, 6000);
});

document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("send-btn").click();
    else if (e.key === "Escape") hideInput();
});

document.getElementById("panel-toggle").addEventListener("click", toggleActionPanel);

document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentTab = btn.dataset.tab;
        renderPanelContent();
    });
});

// === 点击交互 ===

function handleTap() {
    const manifest = state.manifest;
    const skin = manifest && manifest.skins && manifest.skins[state.currentSkinIndex];
    const mode = skin && skin.modes && skin.modes[state.currentModeIndex];
    const modePath = mode ? mode.path : "";

    if (modePath.includes("build") || modePath.includes("back")) {
        if (window.playMotion) window.playMotion("Interact", 0);
        const touchLine = findVoiceLine("trust_touch") || findVoiceLine("poke");
        if (touchLine) {
            if (touchLine.content) showBubble(touchLine.content, 4000);
            playVoiceFile(touchLine.audioFile);
        } else {
            showBubble("(无触摸语音)", 2000);
        }
    } else {
        const selectLines = [findVoiceLine("选中干员1"), findVoiceLine("选中干员2")].filter(Boolean);
        if (selectLines.length > 0) {
            const line = selectLines[Math.floor(Math.random() * selectLines.length)];
            if (line.content) showBubble(line.content, 3000);
            playVoiceFile(line.audioFile);
        } else {
            showBubble("(无选中语音)", 2000);
        }
    }
}

function findVoiceLine(key) {
    const lines = state.voiceLines;
    if (!lines || !Array.isArray(lines)) return null;
    return lines.find(l => l.key === key || l.title === key) || null;
}

// === Spine event bridge ===

window.notifySwift = function(type, data) {
    if (type === "tap") {
        handleTap();
        toggleInput();
    } else if (type === "drag") {
        appWindow.startDragging();
    } else if (type === "contextmenu") {
        // Show native context menu via Rust
        const isLive2D = state.manifest && state.manifest.type === "live2d";
        let motions = [];
        if (isLive2D) {
            for (const [group, count] of Object.entries(motionGroups)) {
                if (count > 1) {
                    for (let i = 0; i < count; i++) motions.push(`${group}:${i}`);
                } else {
                    motions.push(group);
                }
            }
        } else {
            motions = Object.keys(motionGroups).sort();
        }
        const x = Number.isFinite(data?.x) ? data.x : null;
        const y = Number.isFinite(data?.y) ? data.y : null;
        invoke("show_context_menu", { motions, x, y }).catch(e => console.error("context menu:", e));
    } else if (type === "ready") {
        motionGroups = data.motionGroups || {};
        modelExpressions = data.expressions || [];
    }
};

// === Spine skel file resolver ===

window.findSkelFile = async function(charId, modePath) {
    const files = await invoke("list_model_files", { charId, subPath: modePath });
    const skel = files.find(f => f.endsWith(".skel"));
    return skel ? skel.replace(".skel", "") : null;
};

// === Live2D model3 file resolver ===

window.findModel3File = async function(charId) {
    const files = await invoke("list_model_files", { charId, subPath: "" });
    const model3 = files.find(f => f.endsWith(".model3.json"));
    return model3 || null;
};

// === MMD file resolvers ===

window.findMMDFile = async function(charId) {
    const files = await invoke("list_model_files", { charId, subPath: "" });
    return files.find(f => f.endsWith(".pmx") || f.endsWith(".pmd")) || null;
};

window.findVMDFiles = async function(charId) {
    const files = await invoke("list_model_files", { charId, subPath: "" });
    return files.filter(f => f.endsWith(".vmd"));
};

// === Init ===

async function initApp() {
    await initState();
    renderSkillBar();
    startIdleChat();

    const greeting = (typeof getLaunchGreeting === "function")
        ? getLaunchGreeting()
        : (state.persona && state.persona.greeting ? state.persona.greeting : null);
    if (greeting) {
        showBubble(greeting, 5000);
    }

    if (typeof startHeartbeat === "function") {
        startHeartbeat();
    }

    // Listen for tray/context menu events
    const { listen } = window.__TAURI__.event;
    listen("clear-chat", () => {
        state.chatHistory = [];
        saveChatHistory();
        showBubble("对话已清空", 2000);
    });
    listen("switch-model", async (event) => {
        const modelId = event.payload;
        if (!modelId) return;
        const parts = modelId.split("/");
        const charId = parts[0];
        const rawModePath = parts.slice(1).join("/");
        const modePath = rawModePath && rawModePath !== "." ? rawModePath : null;
        if (!charId) return;

        const loadModelByType = (fullModelId) => {
            if (state.manifest && state.manifest.type === "live2d") {
                window.switchLive2DModel(fullModelId);
            } else if (state.manifest && state.manifest.type === "mmd") {
                window.switchMMDModel(fullModelId);
            } else {
                window.switchSpineModel(fullModelId);
            }
        };

        if (charId !== state.currentChar) {
            await switchCharacter(charId);
            renderSkillBar();
            startIdleChat();
        }

        // `model:char/.` means "character default mode".
        // switchCharacter already handled loading default mode above.
        if (modePath) {
            loadModelByType(`${charId}/${modePath}`);
        }

        if (modePath && state.manifest && state.manifest.skins) {
            let found = false;
            for (let si = 0; si < state.manifest.skins.length; si++) {
                const modes = state.manifest.skins[si].modes || [];
                for (let mi = 0; mi < modes.length; mi++) {
                    if (modes[mi].path === modePath) {
                        state.currentSkinIndex = si;
                        state.currentModeIndex = mi;
                        renderSkillBar();
                        // Apply per-mode scale
                        state.userScale = getScaleForMode(modePath);
                        setTimeout(() => {
                            if (state.manifest && state.manifest.type === "mmd") {
                                if (window.mmdSetScale) window.mmdSetScale(state.userScale);
                            } else {
                                if (window.setUserScale) window.setUserScale(state.userScale);
                            }
                        }, 300);
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }
    });
    listen("play-motion", (event) => {
        if (!event.payload) return;
        if (state.manifest && state.manifest.type === "live2d") {
            const parts = event.payload.split(":");
            const group = parts[0];
            const index = parts.length > 1 ? parseInt(parts[1]) : 0;
            window.live2dPlayMotion(group, index);
        } else if (state.manifest && state.manifest.type === "mmd") {
            if (window.mmdPlayMotion) window.mmdPlayMotion(event.payload);
        } else {
            window.playMotion(event.payload, 0);
        }
    });
    listen("set-scale", (event) => {
        if (event.payload != null) {
            state.userScale = event.payload;
            saveCharPrefs();
            if (state.manifest && state.manifest.type === "mmd") {
                if (window.mmdSetScale) window.mmdSetScale(event.payload);
            } else {
                window.setUserScale(event.payload);
            }
        }
    });
    listen("flip-model", () => {
        if (state.manifest && state.manifest.type === "live2d") {
            if (window.live2dFlipModel) window.live2dFlipModel();
        } else if (state.manifest && state.manifest.type === "mmd") {
            if (window.mmdFlipModel) window.mmdFlipModel();
        } else {
            if (window.flipModel) window.flipModel();
        }
    });
}

initApp();
