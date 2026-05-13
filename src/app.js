const appWindow = getCurrentWebviewWindow();
const { LogicalSize } = window.__TAURI__.dpi;

let bubbleTimer = null;
let idleChatTimer = null;
let currentTab = "archive";
let motionGroups = {};
let modelExpressions = [];

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
        if (audioFile && state.currentChar) {
            invoke("play_audio", { charId: state.currentChar, file: audioFile, lang: state.voiceLang });
        }
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
            if (line.audioFile && state.currentChar) {
                invoke("play_audio", { charId: state.currentChar, file: line.audioFile, lang: state.voiceLang });
            }
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
            <option value="openai" ${config.provider === 'openai' ? 'selected' : ''}>OpenAI Compatible</option>
            <option value="anthropic" ${config.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
        </select>
        <label>Endpoint</label>
        <input type="text" id="llm-endpoint" value="${config.endpoint || ''}" placeholder="https://api.openai.com">
        <label>API Key</label>
        <input type="password" id="llm-apikey" value="${config.api_key || ''}" placeholder="sk-...">
        <label>Model</label>
        <input type="text" id="llm-model" value="${config.model || ''}" placeholder="gpt-4o-mini">
        <label>缩放</label>
        <input type="range" id="scale-slider" min="0.5" max="2.0" step="0.1" value="1.0">
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
            window.setUserScale(parseFloat(e.target.value));
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
        const text = scriptedReply();
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
    showBubble("…", 30000);
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

// === Spine event bridge ===

window.notifySwift = function(type, data) {
    if (type === "tap") {
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
        invoke("show_context_menu", { motions }).catch(e => console.error("context menu:", e));
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
    if (state.persona && state.persona.greeting) {
        showBubble(state.persona.greeting, 5000);
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
        const charId = modelId.split("/")[0];
        if (charId !== state.currentChar) {
            await switchCharacter(charId);
            renderSkillBar();
            startIdleChat();
        } else {
            if (state.manifest && state.manifest.type === "live2d") {
                window.switchLive2DModel(modelId);
            } else {
                window.switchSpineModel(modelId);
            }
        }
        if (state.manifest && state.manifest.skins) {
            const modePath = modelId.split("/").slice(1).join("/");
            for (let si = 0; si < state.manifest.skins.length; si++) {
                const modes = state.manifest.skins[si].modes || [];
                for (let mi = 0; mi < modes.length; mi++) {
                    if (modes[mi].path === modePath) {
                        state.currentSkinIndex = si;
                        state.currentModeIndex = mi;
                        renderSkillBar();
                        break;
                    }
                }
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
