let live2dModel = null;
let live2dIdleTimer = null;
let live2dBoredTimer = null;
let live2dLastInteraction = Date.now();
let live2dIsPlayingMotion = false;
let live2dDefaultParams = null;
let live2dModelConfig = null;

const LIVE2D_MODEL_BASE = window.SPINE_MODEL_BASE || "model/";

function getLive2DApp() {
    return window._pixiApp || null;
}

window.switchLive2DModel = async function(modelId) {
    const charId = modelId.split("/")[0];
    const basePath = LIVE2D_MODEL_BASE + charId + "/";

    try {
        let modelFile = null;
        if (window.findModel3File) {
            modelFile = await window.findModel3File(charId);
        } else {
            const resp = await fetch(basePath);
            const html = await resp.text();
            const match = html.match(/[\w\-]+\.model3\.json/);
            if (match) modelFile = match[0];
        }

        if (!modelFile) {
            console.error("找不到 .model3.json:", modelId);
            return;
        }

        await loadLive2DModel(basePath + modelFile);
    } catch (e) {
        console.error("Live2D 模型加载失败:", e);
    }
};

async function loadLive2DModel(modelPath) {
    if (window.destroySpineApp) window.destroySpineApp();
    if (window.destroyMMD) window.destroyMMD();
    const mmdCanvas = document.getElementById('mmd-canvas');
    if (mmdCanvas) mmdCanvas.style.display = 'none';
    const spineCanvas = document.getElementById('spine-canvas');
    if (spineCanvas) spineCanvas.style.display = 'block';

    const pixiApp = getLive2DApp();
    if (!pixiApp) {
        console.error("PIXI app not available for Live2D");
        return;
    }

    if (live2dModel) {
        pixiApp.stage.removeChild(live2dModel);
        live2dModel.destroy();
        live2dModel = null;
    }
    if (live2dIdleTimer) { clearInterval(live2dIdleTimer); live2dIdleTimer = null; }
    if (live2dBoredTimer) { clearInterval(live2dBoredTimer); live2dBoredTimer = null; }

    const modelDir = modelPath.substring(0, modelPath.lastIndexOf("/") + 1);
    live2dModelConfig = await loadLive2DConfig(modelDir);

    live2dModel = await PIXI.live2d.Live2DModel.from(modelPath, {
        autoInteract: false,
        autoUpdate: true,
    });

    const bottomMargin = 70;
    const topMargin = 50;
    const availableHeight = pixiApp.screen.height - bottomMargin - topMargin;
    const scale = (availableHeight * 0.9) / live2dModel.height;
    live2dModel.anchor.set(0.5, 0.5);
    live2dModel.scale.set(scale);
    live2dModel.x = pixiApp.screen.width / 2;
    live2dModel.y = pixiApp.screen.height / 2;

    pixiApp.stage.addChild(live2dModel);

    saveLive2DDefaultParams();
    startLive2DIdleLoop();

    const motionGroups = getLive2DMotionGroups();
    if (window.notifySwift) {
        window.notifySwift("ready", { expressions: getLive2DExpressions(), motionGroups });
    }
    console.log("Live2D 模型加载完成:", modelPath);
}

function destroyLive2D() {
    if (live2dIdleTimer) { clearInterval(live2dIdleTimer); live2dIdleTimer = null; }
    if (live2dBoredTimer) { clearInterval(live2dBoredTimer); live2dBoredTimer = null; }
    const pixiApp = getLive2DApp();
    if (live2dModel && pixiApp) {
        pixiApp.stage.removeChild(live2dModel);
        live2dModel.destroy();
    }
    live2dModel = null;
}
window.destroyLive2D = destroyLive2D;

function getLive2DExpressions() {
    if (!live2dModel) return [];
    const defs = live2dModel.internalModel.settings.expressions;
    if (!defs) return [];
    return defs.map(e => e.Name || e.name || "unknown");
}

function getLive2DMotionGroups() {
    if (!live2dModel) return {};
    const motions = live2dModel.internalModel.settings.motions;
    if (!motions) return {};
    const result = {};
    for (const [group, items] of Object.entries(motions)) {
        result[group] = items.length;
    }
    return result;
}

window.live2dPlayMotion = function(group, index) {
    if (!live2dModel) return;
    index = index !== undefined ? index : 0;
    live2dIsPlayingMotion = true;
    live2dModel.motion(group, index, 3);
    function checkEnd() {
        if (!live2dModel) { live2dIsPlayingMotion = false; return; }
        const mgr = live2dModel.internalModel.motionManager;
        if (mgr.isFinished()) {
            resetLive2DParams();
            live2dIsPlayingMotion = false;
            return;
        }
        requestAnimationFrame(checkEnd);
    }
    requestAnimationFrame(checkEnd);
};

window.live2dSetExpression = function(name) {
    if (!live2dModel) return;
    live2dModel.expression(name);
};

function saveLive2DDefaultParams() {
    if (!live2dModel) return;
    try {
        const coreModel = live2dModel.internalModel.coreModel;
        const params = coreModel._model;
        if (params && params.parameters) {
            const ids = params.parameters.ids;
            const defaults = params.parameters.defaultValues;
            live2dDefaultParams = {};
            for (let i = 0; i < ids.length; i++) {
                live2dDefaultParams[ids[i]] = defaults[i];
            }
        }
    } catch(e) {}
}

function resetLive2DParams() {
    if (!live2dModel || !live2dDefaultParams) return;
    try {
        const coreModel = live2dModel.internalModel.coreModel;
        let frame = 0;
        const totalFrames = 20;
        const currentValues = {};
        for (const id of Object.keys(live2dDefaultParams)) {
            currentValues[id] = coreModel.getParameterValueById(id);
        }
        function step() {
            frame++;
            const t = frame / totalFrames;
            for (const [id, target] of Object.entries(live2dDefaultParams)) {
                const current = currentValues[id];
                coreModel.setParameterValueById(id, current + (target - current) * t);
            }
            if (frame < totalFrames) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    } catch(e) {}
}

function startLive2DIdleLoop() {
    if (live2dIdleTimer) clearInterval(live2dIdleTimer);
    if (live2dBoredTimer) clearInterval(live2dBoredTimer);

    try {
        const motions = live2dModel.internalModel.settings.motions;
        if (motions && motions["Idle"] && motions["Idle"].length > 0) {
            live2dIdleTimer = setInterval(() => {
                if (!live2dModel || live2dIsPlayingMotion) return;
                live2dModel.motion("Idle", 0, 1);
            }, 15000);
        }
    } catch(e) {}

    live2dBoredTimer = setInterval(() => {
        const idleSeconds = (Date.now() - live2dLastInteraction) / 1000;
        if (idleSeconds < 30 || live2dIsPlayingMotion || !live2dModel) return;
        const exprs = getLive2DExpressions();
        if (exprs.length > 0 && Math.random() < 0.3) {
            const expr = exprs[Math.floor(Math.random() * exprs.length)];
            live2dModel.expression(expr);
            setTimeout(() => { if (live2dModel) live2dModel.expression(); }, 3000);
        }
    }, 20000);
}

async function loadLive2DConfig(modelDir) {
    try {
        const resp = await fetch(modelDir + "config.json");
        if (resp.ok) return await resp.json();
    } catch (_) {}
    return null;
}

window.live2dFlipModel = function() {
    if (!live2dModel) return;
    live2dModel.scale.x *= -1;
};

window.live2dSetEmotion = function(mood, energy) {
    if (!live2dModel) return;
    live2dLastInteraction = Date.now();
    if (live2dModelConfig && live2dModelConfig.emotionMap && live2dModelConfig.emotionMap[mood]) {
        live2dModel.expression(live2dModelConfig.emotionMap[mood]);
    }
    if (live2dModelConfig && live2dModelConfig.motionMap && live2dModelConfig.motionMap[energy]) {
        const m = live2dModelConfig.motionMap[energy];
        window.live2dPlayMotion(m.group, m.index);
    }
};
