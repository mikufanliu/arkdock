import * as THREE from './lib/three.module.js';
import { MMDLoader } from './lib/MMDLoader.js';
import { MMDAnimationHelper } from './lib/MMDAnimationHelper.js';

let scene, camera, renderer, helper, mesh;
let clock = new THREE.Clock();
let currentMotions = [];
let availableVmds = [];

async function initMMD() {
    const canvas = document.getElementById("mmd-canvas");

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 1000);
    camera.position.set(0, 13, 30);
    camera.lookAt(0, 10, 0);

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);

    // 光照
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.5);
    directional.position.set(0, 20, 10);
    scene.add(directional);

    helper = new MMDAnimationHelper({ afterglow: 2.0 });

    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // 拖拽/点击检测
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
        if (!isDragging) {
            notifySwift("tap", {});
        }
        isDragging = false;
    });

    animate();
    console.log("MMD renderer initialized");
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (helper) helper.update(delta);
    if (renderer && scene && camera) renderer.render(scene, camera);
}

// === 模型加载 ===

async function loadMMDModel(modelPath) {
    const loader = new MMDLoader();

    return new Promise((resolve, reject) => {
        loader.load(modelPath, (object) => {
            if (mesh) {
                helper.remove(mesh);
                scene.remove(mesh);
            }
            mesh = object;
            mesh.position.set(0, 0, 0);
            scene.add(mesh);
            helper.add(mesh, { animation: null, physics: false });

            // 自动调整相机：确保全身可见
            const box = new THREE.Box3().setFromObject(mesh);
            const height = box.max.y - box.min.y;
            const centerY = (box.max.y + box.min.y) / 2;
            const fov = camera.fov * (Math.PI / 180);
            const dist = (height / 2) / Math.tan(fov / 2) * 1.1;
            camera.position.set(0, centerY, dist);
            camera.lookAt(0, centerY, 0);

            console.log("MMD模型加载完成:", modelPath);
            notifySwift("ready", { expressions: [], motionGroups: {} });
            resolve(mesh);
        }, undefined, (err) => {
            console.error("MMD模型加载失败:", err);
            reject(err);
        });
    });
}

// === VMD 动作加载和播放 ===

function loadAndPlayVMD(vmdPath) {
    if (!mesh) return;
    const loader = new MMDLoader();
    loader.loadAnimation(vmdPath, mesh, (clip) => {
        helper.remove(mesh);
        helper.add(mesh, { animation: clip, physics: false });
        console.log("VMD动作播放:", vmdPath);
    });
}

// === 全局接口（供 Swift 调用）===

window.switchMMDModel = async function(modelId) {
    const basePath = "model/" + modelId + "/";
    try {
        const resp = await fetch(basePath);
        const html = await resp.text();
        // 找 .pmx 或 .pmd 文件
        const pmxMatch = html.match(/[\w\-\.]+\.pmx/i);
        const pmdMatch = html.match(/[\w\-\.]+\.pmd/i);
        const modelFile = pmxMatch ? pmxMatch[0] : (pmdMatch ? pmdMatch[0] : null);
        if (modelFile) {
            await loadMMDModel(basePath + modelFile);
            // 找 VMD 动作文件
            const vmdMatches = html.matchAll(/[\w\-\.]+\.vmd/gi);
            availableVmds = [...vmdMatches].map(m => ({ name: m[0].replace('.vmd',''), path: basePath + m[0] }));
            notifySwift("ready", {
                expressions: [],
                motionGroups: Object.fromEntries(availableVmds.map((v, i) => [v.name, 1]))
            });
        }
    } catch(e) {
        console.error("MMD模型切换失败:", e);
    }
};

window.playMotion = function(group, index) {
    const vmd = availableVmds.find(v => v.name === group);
    if (vmd) {
        loadAndPlayVMD(vmd.path);
    }
};

window.setExpression = function() {};
window.setEmotion = function() {};

function notifySwift(type, data) {
    if (window.webkit && window.webkit.messageHandlers.petEvent) {
        window.webkit.messageHandlers.petEvent.postMessage({ type, ...data });
    }
}

// === 启动 ===
initMMD();
