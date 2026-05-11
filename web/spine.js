let app = null;
let spineObj = null;
let currentAnimations = [];
let idleAnim = null;
let idleTimer = null;
let displayScale = 1.0;
let userScale = 1.0;

async function initSpine() {
    const canvas = document.getElementById("spine-canvas");

    app = new PIXI.Application({
        view: canvas,
        autoStart: true,
        resizeTo: window,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 2,
        autoDensity: true,
    });

    let dragStartX = 0, dragStartY = 0, isDragging = false;
    canvas.addEventListener("mousedown", (e) => {
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isDragging = false;
    });
    canvas.addEventListener("mousemove", (e) => {
        if (e.buttons === 1) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (!isDragging && (dx * dx + dy * dy) > 25) {
                isDragging = true;
                notifySwift("drag", {});
            }
        }
    });
    canvas.addEventListener("mouseup", () => {
        if (!isDragging) notifySwift("tap", {});
        isDragging = false;
    });

    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        notifySwift("contextmenu", { x: e.clientX, y: e.clientY });
    });

    canvas.addEventListener("mousemove", (e) => {
        if (spineObj && !isDragging) {
            const centerX = app.screen.width / 2;
            const shouldFaceLeft = e.clientX < centerX;
            const currentScale = Math.abs(spineObj.scale.x);
            spineObj.scale.x = shouldFaceLeft ? -currentScale : currentScale;
        }
    });

    window.addEventListener("resize", () => {
        if (spineObj) fitSpine();
    });

    console.log("Spine renderer initialized");
}

function fitSpine() {
    if (!spineObj || !app) return;
    const bounds = spineObj.getLocalBounds();
    console.log("Spine bounds:", JSON.stringify({x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height}), "screen:", app.screen.width, "x", app.screen.height, "displayScale:", displayScale);
    const targetHeight = app.screen.height * 0.7 * displayScale * userScale;
    const scale = targetHeight / bounds.height;
    spineObj.scale.set(scale);
    spineObj.x = app.screen.width / 2;
    spineObj.y = app.screen.height * 0.88;
}

// === 模型加载 ===

window.switchSpineModel = async function(modelId) {
    const basePath = "model/" + modelId + "/";
    const charId = modelId.split("/")[0];
    const modePath = modelId.split("/").slice(1).join("/");

    try {
        // 读取 manifest 获取 displayScale
        try {
            const manifestResp = await fetch("model/" + charId + "/manifest.json");
            if (manifestResp.ok) {
                const manifest = await manifestResp.json();
                let base = manifest.displayScale || 1.0;
                let modeMultiplier = (manifest.modeScales && manifest.modeScales[modePath]) || 1.0;
                displayScale = base * modeMultiplier;
            } else {
                displayScale = 1.0;
            }
        } catch (e) {
            displayScale = 1.0;
        }

        const resp = await fetch(basePath);
        const html = await resp.text();
        const skelMatch = html.match(/[\w\-\.]+\.skel/i);
        if (!skelMatch) {
            console.error("找不到 .skel 文件:", modelId);
            return;
        }

        const skelName = skelMatch[0].replace(".skel", "");
        const skelPath = basePath + skelName + ".skel";
        const atlasPath = basePath + skelName + ".atlas";

        await loadSpineModel(skelName, skelPath, atlasPath);
    } catch (e) {
        console.error("Spine 模型加载失败:", e);
        notifySwift("error", { message: e.message });
    }
};

async function loadSpineModel(name, skelPath, atlasPath) {
    if (spineObj) {
        app.stage.removeChild(spineObj);
        spineObj.destroy();
        spineObj = null;
    }
    stopIdleTimer();

    const loader = new PIXI.Loader();
    loader.add(name, skelPath, {
        metadata: { spineAtlasFile: atlasPath },
        xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER,
    });

    return new Promise((resolve, reject) => {
        loader.load((loader, resources) => {
            const res = resources[name];
            if (!res || !res.spineData) {
                reject(new Error("Spine 数据加载失败"));
                return;
            }

            spineObj = new PIXI.spine.Spine(res.spineData);
            spineObj.state.data.defaultMix = 0.25;
            app.stage.addChild(spineObj);
            fitSpine();

            currentAnimations = spineObj.spineData.animations.map(a => a.name);
            console.log("全部动画:", currentAnimations);

            // 找 idle 动画（兼容后缀如 IdleZ, Idlev）
            idleAnim = currentAnimations.find(a => /^Idle.?$/i.test(a))
                || currentAnimations.find(a => /idle|relax|wait|standby/i.test(a))
                || currentAnimations[0];

            // 入场：有 Start 就先播 Start，播完自动进 Idle
            const startAnim = currentAnimations.find(a => /^Start.?$/i.test(a));
            if (startAnim) {
                spineObj.state.setAnimation(0, startAnim, false);
                if (idleAnim) {
                    spineObj.state.addAnimation(0, idleAnim, true, 0);
                }
            } else if (idleAnim) {
                spineObj.state.setAnimation(0, idleAnim, true);
            }

            // 启动随机动作定时器
            startIdleTimer();

            // 通知 Swift
            const motionGroups = {};
            currentAnimations.forEach(a => { motionGroups[a] = 1; });
            notifySwift("ready", { expressions: [], motionGroups });

            console.log("Spine 加载完成, idle:", idleAnim, ", start:", startAnim || "无");
            resolve();
        });

        loader.onError.add((err) => reject(err));
    });
}

// === 动画播放（带平滑过渡） ===

let isPlayingAction = false;

function playAnimation(animName) {
    if (!spineObj || !animName) return;
    if (!currentAnimations.includes(animName)) return;

    isPlayingAction = true;
    stopIdleTimer();

    const state = spineObj.state;
    state.clearListeners();

    // 播放目标动画（非循环）
    state.setAnimation(0, animName, false);

    // 播完后平滑过渡回 Idle
    if (idleAnim) {
        state.addAnimation(0, idleAnim, true, 0);
    }

    state.addListener({
        complete: function(entry) {
            if (entry.animation.name === animName) {
                isPlayingAction = false;
                startIdleTimer();
                state.clearListeners();
            }
        }
    });
}

// === 随机动作系统 ===

function getRandomActions() {
    const excludeExact = /^(idle|default|die|stun|start).?$/i;
    const excludeSuffix = /_?(begin|end|loop|down_loop|start).?$/i;
    const excludeContains = /^(die|stun)/i;
    const singles = currentAnimations.filter(a =>
        !excludeExact.test(a) && !excludeSuffix.test(a) && !excludeContains.test(a)
    );

    // 检测 Begin/Start 序列，把序列头也加入随机池
    const sequences = [];
    for (const a of currentAnimations) {
        if (/_?(Begin|Start).?$/i.test(a) && !/^Start.?$/i.test(a)) {
            sequences.push(a);
        }
    }

    return [...singles, ...sequences];
}

function buildPlayableSequence(animName) {
    // 从动画名推导出 base（去掉 _Begin/_End/_Loop/_Start/_Attack/_Idle + 可选单字符后缀）
    let base = animName.replace(/[_\s]?(Begin|End|Loop|Down_Loop|Attack|Idle|Start).?$/i, '');
    if (base === animName) base = animName;

    // 尝试匹配序列（兼容后缀如 Z, v）
    const begin = currentAnimations.find(a => new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(Begin|Start).?$', 'i').test(a));
    const loop = currentAnimations.find(a => new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(Loop|Down_Loop).?$', 'i').test(a));
    const end = currentAnimations.find(a => new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(End).?$', 'i').test(a));

    if (begin && end) {
        const seq = [begin];
        if (loop) seq.push(loop);
        seq.push(end);
        return seq;
    }
    if (begin) return [begin];
    return [animName];
}

function playSequenceChain(chain) {
    if (!spineObj || chain.length === 0) return;
    isPlayingAction = true;
    stopIdleTimer();

    const state = spineObj.state;
    state.clearListeners();

    state.setAnimation(0, chain[0], false);
    for (let i = 1; i < chain.length; i++) {
        const isLoop = /loop/i.test(chain[i]);
        if (isLoop) {
            state.addAnimation(0, chain[i], true, 0);
            // loop 段播 2 秒后接下一段
            if (i + 1 < chain.length) {
                const remaining = chain.slice(i + 1);
                setTimeout(() => {
                    state.setAnimation(0, remaining[0], false);
                    for (let j = 1; j < remaining.length; j++) {
                        state.addAnimation(0, remaining[j], false, 0);
                    }
                    if (idleAnim) state.addAnimation(0, idleAnim, true, 0);
                }, 2000);
                state.addListener({
                    complete: function(entry) {
                        if (entry.animation.name === remaining[remaining.length - 1]) {
                            isPlayingAction = false;
                            startIdleTimer();
                            state.clearListeners();
                        }
                    }
                });
                return;
            }
            break;
        }
        state.addAnimation(0, chain[i], false, 0);
    }

    if (idleAnim) state.addAnimation(0, idleAnim, true, 0);

    const lastAnim = chain[chain.length - 1];
    state.addListener({
        complete: function(entry) {
            if (entry.animation.name === lastAnim) {
                isPlayingAction = false;
                startIdleTimer();
                state.clearListeners();
            }
        }
    });
}

function startIdleTimer() {
    stopIdleTimer();
    scheduleNextAction();
}

function stopIdleTimer() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
}

function scheduleNextAction() {
    const delay = 8000 + Math.random() * 12000; // 8~20秒
    idleTimer = setTimeout(() => {
        if (isPlayingAction) return;
        const actions = getRandomActions();
        if (actions.length === 0) { scheduleNextAction(); return; }
        const pick = actions[Math.floor(Math.random() * actions.length)];
        const chain = buildPlayableSequence(pick);
        console.log("随机动作:", chain.join(" → "));
        playSequenceChain(chain);
    }, delay);
}

// === 全局接口 ===

window.playMotion = function(name, index) {
    if (!spineObj) return;

    console.log("playMotion called:", name, "available:", currentAnimations.join(","));
    const animName = currentAnimations.find(a => a === name) || currentAnimations[index];
    if (animName) {
        const chain = buildPlayableSequence(animName);
        console.log("手动动作:", chain.join(" → "));
        playSequenceChain(chain);
    } else {
        console.log("动画未找到:", name);
    }
};

window.setExpression = function() {};

window.setUserScale = function(scale) {
    userScale = scale;
    fitSpine();
};

window.flipModel = function() {
    if (!spineObj) return;
    spineObj.scale.x *= -1;
};

window.setEmotion = function(mood, energy) {
    if (!spineObj) return;
    const map = {
        excited: "Attack",
        greeting: "Start",
    };
    const target = map[energy] || map[mood];
    if (target && currentAnimations.includes(target)) {
        playAnimation(target);
    }
};

// === 与 Swift 通信 ===

function notifySwift(type, data) {
    if (window.webkit && window.webkit.messageHandlers.petEvent) {
        window.webkit.messageHandlers.petEvent.postMessage({ type, ...data });
    }
}

// === 启动 ===
initSpine();
