let app = null;
let spineObj = null;
let currentAnimations = [];
let idleAnim = null;
let idleTimer = null;
let displayScale = 1.0;
let userScale = 1.0;
let spineLoadToken = 0;
const MODEL_BASE = window.SPINE_MODEL_BASE || "model/";

async function initSpine() {
    const canvas = document.getElementById("spine-canvas");
    const mainArea = document.getElementById("main-area") || canvas.parentElement;

    app = new PIXI.Application({
        view: canvas,
        autoStart: true,
        resizeTo: mainArea,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 2,
        autoDensity: true,
    });

    let dragStartX = 0, dragStartY = 0, isDragging = false;
    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // only left button starts tap/drag flow
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isDragging = false;
    });
    canvas.addEventListener("mousemove", (e) => {
        if ((e.buttons & 1) === 1) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (!isDragging && (dx * dx + dy * dy) > 25) {
                isDragging = true;
                notifySwift("drag", {});
            }
        }
    });
    canvas.addEventListener("mouseup", (e) => {
        if (e.button !== 0) return; // ignore right/middle release
        if (!isDragging) notifySwift("tap", {});
        isDragging = false;
    });

    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        notifySwift("contextmenu", { x: e.clientX, y: e.clientY });
    });

    document.addEventListener("mousemove", (e) => {
        if (spineObj && !isDragging) {
            const centerX = window.innerWidth / 2;
            const shouldFaceLeft = e.clientX < centerX;
            const currentScale = Math.abs(spineObj.scale.x);
            spineObj.scale.x = shouldFaceLeft ? -currentScale : currentScale;
        }
    });

    window.addEventListener("resize", () => {
        if (spineObj) fitSpine();
    });

    window._pixiApp = app;
    console.log("Spine renderer initialized");
}

window.destroySpineApp = function() {
    // Invalidate any in-flight async load so stale callbacks cannot re-attach models.
    spineLoadToken += 1;
    stopIdleTimer();
    if (spineObj) {
        app.stage.removeChild(spineObj);
        spineObj.destroy({ children: true, texture: true, baseTexture: true });
        spineObj = null;
    }
    app.stage.removeChildren();
    currentAnimations = [];
    idleAnim = null;
};

function fitSpine() {
    if (!spineObj || !app) return;

    const bottomMargin = 90;
    const topMargin = 50;
    const availableHeight = app.screen.height - bottomMargin - topMargin;

    // Use setup pose bounds for consistent sizing across animations
    let refHeight;
    const skelData = spineObj.spineData || spineObj.skeleton?.data;
    if (skelData && skelData.height > 10) {
        refHeight = skelData.height;
    } else {
        // Measure setup pose bounds (stable reference, not affected by current animation)
        spineObj.skeleton.setToSetupPose();
        spineObj.skeleton.updateWorldTransform();
        const setupBounds = spineObj.getLocalBounds();
        refHeight = setupBounds.height;
        // Restore animation
        if (spineObj.state.getCurrent(0)) {
            spineObj.state.apply(spineObj.skeleton);
            spineObj.skeleton.updateWorldTransform();
        }
    }

    const targetHeight = availableHeight * displayScale * userScale;
    const scale = targetHeight / refHeight;

    spineObj.scale.set(scale);
    spineObj.x = app.screen.width / 2;
    spineObj.y = app.screen.height - bottomMargin;
}

// === 模型加载 ===

window.switchSpineModel = async function(modelId) {
    const loadToken = ++spineLoadToken;
    const basePath = MODEL_BASE + modelId + "/";
    const charId = modelId.split("/")[0];
    const modePath = modelId.split("/").slice(1).join("/");

    try {
        // userScale will be set by state.js before/after model load
        displayScale = 1.0;

        let skelName = null;

        // 如果有 findSkelFile hook（Tauri 环境），用它查找 .skel 文件
        if (window.findSkelFile) {
            skelName = await window.findSkelFile(charId, modePath);
        } else {
            // 降级：通过目录列表查找（本地 HTTP server 环境）
            const resp = await fetch(basePath);
            const html = await resp.text();
            const skelMatch = html.match(/[\w\-\.]+\.skel/i);
            if (skelMatch) {
                skelName = skelMatch[0].replace(".skel", "");
            }
        }

        if (!skelName) {
            console.error("找不到 .skel 文件:", modelId);
            return;
        }
        if (loadToken !== spineLoadToken) return;

        const skelPath = basePath + skelName + ".skel";
        const atlasPath = basePath + skelName + ".atlas";

        await loadSpineModel(skelName, skelPath, atlasPath, loadToken);
    } catch (e) {
        console.error("Spine 模型加载失败:", e);
        if (loadToken === spineLoadToken) {
            notifySwift("error", { message: e.message });
        }
    }
};

async function loadSpineModel(name, skelPath, atlasPath, loadToken) {
    if (loadToken !== spineLoadToken) return;
    stopIdleTimer();

    // Destroy live2d and mmd if active
    if (window.destroyLive2D) window.destroyLive2D();
    if (window.destroyMMD) window.destroyMMD();
    const mmdCanvas = document.getElementById('mmd-canvas');
    if (mmdCanvas) mmdCanvas.style.display = 'none';
    const spineCanvas = document.getElementById('spine-canvas');
    if (spineCanvas) spineCanvas.style.display = 'block';
    if (loadToken !== spineLoadToken) return;

    // Clear old spine object and stage
    if (spineObj) {
        app.stage.removeChild(spineObj);
        spineObj.destroy({ children: true, texture: true, baseTexture: true });
        spineObj = null;
    }
    app.stage.removeChildren();
    currentAnimations = [];
    idleAnim = null;

    const loaderId = name + "_" + Date.now();
    const loader = new PIXI.Loader();
    loader.add(loaderId, skelPath, {
        metadata: { spineAtlasFile: atlasPath },
        xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER,
    });

    return new Promise((resolve, reject) => {
        loader.load((loader, resources) => {
            if (loadToken !== spineLoadToken) {
                loader.destroy();
                resolve();
                return;
            }
            const res = resources[loaderId];
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

            // Refit after a frame to ensure correct dimensions
            requestAnimationFrame(() => {
                if (loadToken === spineLoadToken) fitSpine();
            });

            console.log("Spine 加载完成, idle:", idleAnim, ", start:", startAnim || "无");
            loader.destroy();
            resolve();
        });

        loader.onError.add((err) => {
            loader.destroy();
            if (loadToken !== spineLoadToken) {
                resolve();
                return;
            }
            reject(err);
        });
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
    let base = animName.replace(/[_\s]?(Begin|End|Loop|Down_Loop|Attack|Idle|Start).?$/i, '');
    if (base === animName) {
        // animName itself might be a base name (e.g. "Skill_3")
        // Check if Start/Begin/Loop variants exist
        const baseEsc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const begin = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(Begin|Start).?$', 'i').test(a));
        const loop = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(Loop|Down_Loop).?$', 'i').test(a));
        const end = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(End).?$', 'i').test(a));

        if (begin && end) {
            const seq = [begin];
            if (loop) seq.push(loop);
            seq.push(end);
            return seq;
        }
        if (begin && loop) {
            return [begin, loop];
        }
        if (begin) return [begin];
        // No sequence parts found — play animName itself if it exists
        return [animName];
    }

    const baseEsc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const begin = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(Begin|Start).?$', 'i').test(a));
    const loop = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(Loop|Down_Loop).?$', 'i').test(a));
    const end = currentAnimations.find(a => new RegExp('^' + baseEsc + '_(End).?$', 'i').test(a));

    if (begin && end) {
        const seq = [begin];
        if (loop) seq.push(loop);
        seq.push(end);
        return seq;
    }
    if (begin && loop) {
        return [begin, loop];
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
            if (i + 1 < chain.length) {
                // loop then remaining parts
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
            // loop is last item: play for 3 seconds then return to idle
            setTimeout(() => {
                if (idleAnim) {
                    state.setAnimation(0, idleAnim, true);
                }
                isPlayingAction = false;
                startIdleTimer();
                state.clearListeners();
            }, 3000);
            return;
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
    let animName = currentAnimations.find(a => a === name);
    if (!animName) {
        animName = currentAnimations.find(a => a.toLowerCase() === name.toLowerCase());
    }
    if (!animName) {
        animName = currentAnimations.find(a => a.toLowerCase().includes(name.toLowerCase())
            || name.toLowerCase().includes(a.toLowerCase()));
    }
    // Fallback: Skill_N -> try Attack series
    if (!animName && /^skill/i.test(name)) {
        animName = currentAnimations.find(a => /^attack/i.test(a));
    }
    if (!animName) {
        animName = currentAnimations[index];
    }
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
    if (window.notifySwift && window.notifySwift !== notifySwift) {
        window.notifySwift(type, data);
    } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.petEvent) {
        window.webkit.messageHandlers.petEvent.postMessage({ type, ...data });
    }
}

// === 启动 ===
initSpine();
