/**
 * Live2D 模型加载与控制
 *
 * 暴露全局接口供 Swift 端通过 JS Bridge 调用：
 * - setExpression(name)    切换表情
 * - playMotion(group, idx) 播放动作
 * - setLipSync(value)      口型同步 (0-1)
 * - getExpressions()       获取可用表情列表
 * - getMotionGroups()      获取可用动作组
 */

let app = null;
let model = null;

// 默认模型路径（相对于 index.html）
let MODEL_PATH = "model/icegirl/IceGirl.model3.json";

async function initLive2D() {
    const canvas = document.getElementById("live2d-canvas");

    app = new PIXI.Application({
        view: canvas,
        autoStart: true,
        resizeTo: window,
        backgroundAlpha: 0,
    });

    // 拖拽检测（只注册一次）
    let dragStartX = 0, dragStartY = 0, isDragging = false;
    canvas.addEventListener("mousedown", (e) => {
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isDragging = false;
        resetInteractionTimer();
    });
    canvas.addEventListener("mousemove", (e) => {
        if (e.buttons === 1) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (!isDragging && (dx * dx + dy * dy) > 25) {
                isDragging = true;
                if (window.webkit && window.webkit.messageHandlers.petEvent) {
                    window.webkit.messageHandlers.petEvent.postMessage({ type: "drag" });
                }
            }
        }
    });
    canvas.addEventListener("mouseup", (e) => {
        if (!isDragging) {
            if (window.webkit && window.webkit.messageHandlers.petEvent) {
                window.webkit.messageHandlers.petEvent.postMessage({ type: "tap" });
            }
        }
        isDragging = false;
    });

    window.addEventListener("resize", () => {
        if (model) {
            model.x = app.screen.width / 2;
            model.y = app.screen.height * 0.5;
        }
    });

    await loadModel(MODEL_PATH);
}

// === 模型切换 ===

async function switchModel(modelId) {
    // 在 model/ 目录下找到 model3.json
    const basePath = "model/" + modelId + "/";
    try {
        const resp = await fetch(basePath);
        const html = await resp.text();
        // 从目录列表中找 .model3.json 文件
        const match = html.match(/[\w\-]+\.model3\.json/);
        if (match) {
            MODEL_PATH = basePath + match[0];
            await loadModel(MODEL_PATH);
        }
    } catch(e) {
        // fallback: 尝试常见命名
        const candidates = [
            modelId.charAt(0).toUpperCase() + modelId.slice(1) + ".model3.json",
            modelId + ".model3.json",
        ];
        for (const c of candidates) {
            try {
                const r = await fetch(basePath + c, { method: "HEAD" });
                if (r.ok) {
                    MODEL_PATH = basePath + c;
                    await loadModel(MODEL_PATH);
                    return;
                }
            } catch(_) {}
        }
        console.error("找不到模型文件:", modelId);
    }
}

async function loadModel(modelPath) {
    // 移除旧模型
    if (model) {
        app.stage.removeChild(model);
        model.destroy();
        model = null;
    }
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    if (boredTimer) { clearInterval(boredTimer); boredTimer = null; }

    model = await PIXI.live2d.Live2DModel.from(modelPath, {
        autoInteract: false,
        autoUpdate: true,
    });

    // 自动缩放：根据模型实际大小适配窗口
    const targetHeight = app.screen.height * 0.85;
    const scale = targetHeight / model.height;
    model.anchor.set(0.5, 0.5);
    model.scale.set(scale);
    model.x = app.screen.width / 2;
    model.y = app.screen.height * 0.5;

    app.stage.addChild(model);

    model.on("hit", (hitAreas) => {
        if (window.webkit && window.webkit.messageHandlers.petEvent) {
            window.webkit.messageHandlers.petEvent.postMessage({
                type: "hit",
                areas: hitAreas,
            });
        }
    });

    startIdleLoop();

    console.log("Live2D 模型加载完成:", modelPath);
    notifySwift("ready", { expressions: getExpressions(), motionGroups: getMotionGroups() });
}

// === 表情控制 ===

function setExpression(name) {
    if (!model) return;
    model.expression(name);
    console.log("表情切换:", name);
}

function getExpressions() {
    if (!model) return [];
    const defs = model.internalModel.settings.expressions;
    if (!defs) return [];
    return defs.map(e => e.Name || e.name || "unknown");
}

// === 动作控制 ===

function playMotion(group, index) {
    if (!model) return;
    index = index !== undefined ? index : 0;
    model.motion(group, index, 3); // priority=3 (FORCE)
    console.log("播放动作:", group, index);
}

function getMotionGroups() {
    if (!model) return {};
    const motions = model.internalModel.settings.motions;
    if (!motions) return {};
    const result = {};
    for (const [group, items] of Object.entries(motions)) {
        result[group] = items.length;
    }
    return result;
}

// === 口型同步 ===

function setLipSync(value) {
    if (!model || !model.internalModel) return;
    // Cubism4 mouth parameter
    const coreModel = model.internalModel.coreModel;
    if (coreModel && coreModel.setParameterValueById) {
        coreModel.setParameterValueById("ParamMouthOpenY", value);
    }
}

// === 情绪映射 ===

// IceGirl 表情映射
const EMOTION_EXPRESSION_MAP = {
    happy: "星星眼",
    excited: "爱心眼",
    normal: null,
    irritated: "生气",
    sad: "流泪",
    shy: "脸红",
    confused: "疑惑",
    surprised: "惊讶",
    disgusted: "脸黑",
};

const EMOTION_MOTION_MAP = {
    excited: { group: "Action", index: 2 },  // MeiYan
    greeting: { group: "Action", index: 1 }, // HuiShou
};

function setEmotion(mood, energy) {
    resetInteractionTimer();
    const exprName = EMOTION_EXPRESSION_MAP[mood];
    if (exprName) {
        setExpression(exprName);
    } else if (mood === "normal") {
        // 清除表情回到默认
        if (model) model.expression();
    }
    const motionInfo = EMOTION_MOTION_MAP[energy];
    if (motionInfo) {
        playMotion(motionInfo.group, motionInfo.index);
    }
}

// === 空闲动作循环 ===

let idleTimer = null;
let boredTimer = null;
let lastInteraction = Date.now();
let isPlayingMotion = false;

function startIdleLoop() {
    if (idleTimer) clearInterval(idleTimer);
    const motions = model && model.internalModel && model.internalModel.settings.motions;
    if (!motions) return;
    const idleGroup = motions["Idle"] ? "Idle" : motions["Action"] ? "Action" : null;
    if (idleGroup === null) return;

    idleTimer = setInterval(() => {
        if (!model || isPlayingMotion) return;
        isPlayingMotion = true;
        model.motion(idleGroup, 0, 3).finally(() => { isPlayingMotion = false; });
    }, 15000);

    const boredExpressions = ["疑惑", "白眼", "舌头", "猫耳"];
    const boredMotions = [1, 2];

    if (boredTimer) clearInterval(boredTimer);
    boredTimer = setInterval(() => {
        const idleSeconds = (Date.now() - lastInteraction) / 1000;
        if (idleSeconds < 30 || isPlayingMotion) return;

        const rand = Math.random();
        if (rand < 0.4) {
            const expr = boredExpressions[Math.floor(Math.random() * boredExpressions.length)];
            setExpression(expr);
            setTimeout(() => { if (model) model.expression(); }, 3000);
        } else if (rand < 0.7) {
            const motionIdx = boredMotions[Math.floor(Math.random() * boredMotions.length)];
            isPlayingMotion = true;
            model.motion(idleGroup, motionIdx, 3).finally(() => { isPlayingMotion = false; });
        }
    }, 20000);
}

function resetInteractionTimer() {
    lastInteraction = Date.now();
}

// === 主动行为系统 ===

let proactiveTimer = null;
let lastGreetingHour = -1;

const PROACTIVE_MESSAGES = {
    morning: ["早上好～今天也要加油哦！", "早安！新的一天开始啦～", "起来啦？来杯咖啡吧☕"],
    afternoon: ["下午好～要不要休息一下？", "别忘了喝水哦～", "下午了，状态还好吗？"],
    evening: ["晚上好～辛苦了一天呢", "天黑了，注意休息眼睛", "今天过得怎么样？"],
    night: ["还没睡吗…要注意身体哦", "已经很晚了呢…", "夜深了，早点休息吧～"],
    bored: ["好无聊啊…", "有什么好玩的吗？", "戳戳…", "在想什么呢？", "哼哼～", "…zzZ"],
};

function startProactiveBehavior() {
    if (proactiveTimer) clearInterval(proactiveTimer);
    proactiveTimer = setInterval(() => {
        const idleMinutes = (Date.now() - lastInteraction) / 60000;
        const hour = new Date().getHours();

        // 时间问候（每个时段只触发一次）
        let period = null;
        if (hour >= 6 && hour < 12) period = "morning";
        else if (hour >= 12 && hour < 18) period = "afternoon";
        else if (hour >= 18 && hour < 23) period = "evening";
        else period = "night";

        if (lastGreetingHour !== hour && (hour === 6 || hour === 12 || hour === 18 || hour === 23)) {
            lastGreetingHour = hour;
            const msgs = PROACTIVE_MESSAGES[period];
            const msg = msgs[Math.floor(Math.random() * msgs.length)];
            notifySwift("proactive", { content: msg });
            return;
        }

        // 长时间无互动时偶尔冒泡
        if (idleMinutes > 5 && Math.random() < 0.15) {
            const msgs = PROACTIVE_MESSAGES.bored;
            const msg = msgs[Math.floor(Math.random() * msgs.length)];
            notifySwift("proactive", { content: msg });
        }
    }, 60000);
}

// === 与 Swift 通信 ===

function notifySwift(type, data) {
    if (window.webkit && window.webkit.messageHandlers.petEvent) {
        window.webkit.messageHandlers.petEvent.postMessage({ type, ...data });
    }
}

// === 启动 ===
initLive2D().then(() => {
    startProactiveBehavior();
}).catch(err => {
    console.error("Live2D 加载失败:", err);
    notifySwift("error", { message: err.message });
});
