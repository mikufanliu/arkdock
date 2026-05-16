import * as THREE from 'three';
import { MMDLoader } from './lib/MMDLoader.js';
import { MMDAnimationHelper } from './lib/MMDAnimationHelper.js';

let renderer = null;
let scene = null;
let camera = null;
let mesh = null;
let helper = null;
let clock = null;
let animationId = null;
let motionFiles = [];
let currentMotionName = null;

const MMD_MODEL_BASE = '/web/model/';

function initMMD() {
    const canvas = document.getElementById('mmd-canvas');
    if (!canvas) return;

    const parent = document.getElementById('main-area') || canvas.parentElement;
    const w = parent.clientWidth || 350;
    const h = parent.clientHeight || 500;

    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 2);
    renderer.setSize(w, h);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
    camera.position.set(0, 13, 25);
    camera.lookAt(0, 10, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.3);
    directional.position.set(1, 2, 1);
    scene.add(directional);

    // Drag and interaction events
    let dragStartX = 0, dragStartY = 0, isDragging = false;
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // only left button starts tap/drag flow
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        isDragging = false;
    });
    canvas.addEventListener('mousemove', (e) => {
        if ((e.buttons & 1) === 1) {
            const dx = e.clientX - dragStartX;
            const dy = e.clientY - dragStartY;
            if (!isDragging && (dx * dx + dy * dy) > 25) {
                isDragging = true;
                if (window.notifySwift) window.notifySwift('drag', {});
            }
        }
    });
    canvas.addEventListener('mouseup', (e) => {
        if (e.button !== 0) return; // ignore right/middle release
        if (!isDragging && window.notifySwift) window.notifySwift('tap', {});
        isDragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (window.notifySwift) window.notifySwift('contextmenu', { x: e.clientX, y: e.clientY });
    });

    helper = new MMDAnimationHelper();
    clock = new THREE.Clock();

    window.addEventListener('resize', onResize);
}

function onResize() {
    const canvas = document.getElementById('mmd-canvas');
    if (!canvas || !renderer || !camera) return;
    const parent = document.getElementById('main-area') || canvas.parentElement;
    const w = parent.clientWidth || 350;
    const h = parent.clientHeight || 500;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}

function animate() {
    animationId = requestAnimationFrame(animate);
    if (helper && mesh) {
        helper.update(clock.getDelta());
    }
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

function stopAnimation() {
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function destroyMMD() {
    stopAnimation();
    if (mesh) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
        } else if (mesh.material) {
            mesh.material.dispose();
        }
        mesh = null;
    }
    if (helper) {
        helper = new MMDAnimationHelper();
    }
    motionFiles = [];
    currentMotionName = null;
}

window.destroyMMD = destroyMMD;

window.switchMMDModel = async function(modelId) {
    const charId = modelId.split('/')[0];
    window._currentMMDCharId = charId;
    const basePath = MMD_MODEL_BASE + charId + '/';

    // Show MMD canvas first so it has dimensions
    const mmdCanvas = document.getElementById('mmd-canvas');
    const spineCanvas = document.getElementById('spine-canvas');
    if (mmdCanvas) mmdCanvas.style.display = 'block';
    if (spineCanvas) spineCanvas.style.display = 'none';

    // Destroy PIXI renderers
    if (window.destroySpineApp) window.destroySpineApp();
    if (window.destroyLive2D) window.destroyLive2D();

    // Init after canvas is visible
    if (!renderer) initMMD();
    onResize();

    // Destroy existing MMD model
    destroyMMD();

    // Find PMX/PMD file
    let modelFile = null;
    if (window.findMMDFile) {
        modelFile = await window.findMMDFile(charId);
    } else {
        try {
            const resp = await fetch(basePath);
            const html = await resp.text();
            const match = html.match(/[\w\-\.]+\.(pmx|pmd)/i);
            if (match) modelFile = match[0];
        } catch (e) {}
    }

    if (!modelFile) {
        console.error('找不到 MMD 模型文件:', modelId);
        return;
    }

    const modelUrl = basePath + modelFile;
    console.log('加载 MMD 模型:', modelUrl);

    const loader = new MMDLoader();

    try {
        mesh = await new Promise((resolve, reject) => {
            loader.load(modelUrl, (m) => resolve(m), undefined, (e) => reject(e));
        });

        scene.add(mesh);

        // Fit model to view - calculate proper camera distance for FOV
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const fov = camera.fov * (Math.PI / 180);
        const dist = (size.y / 2) / Math.tan(fov / 2) * 1.4;
        camera.position.set(0, center.y, dist);
        camera.lookAt(0, center.y, 0);

        // Find VMD motion files
        motionFiles = [];
        if (window.findVMDFiles) {
            motionFiles = await window.findVMDFiles(charId);
        } else {
            try {
                const resp = await fetch(basePath);
                const html = await resp.text();
                const matches = html.matchAll(/[\w\-\.]+\.vmd/gi);
                for (const m of matches) {
                    motionFiles.push(m[0]);
                }
            } catch (e) {}
        }

        // Load first VMD if available
        if (motionFiles.length > 0) {
            await loadVMD(basePath + motionFiles[0], motionFiles[0]);
        }

        // Start rendering
        clock.start();
        animate();

        // Notify ready
        const motionGroups = {};
        motionFiles.forEach(f => {
            const name = f.replace('.vmd', '');
            motionGroups[name] = 1;
        });
        if (window.notifySwift) {
            window.notifySwift('ready', { expressions: [], motionGroups });
        }

        console.log('MMD 加载完成, motions:', motionFiles);
        onResize();
    } catch (e) {
        console.error('MMD 模型加载失败:', e);
    }
};

async function loadVMD(vmdUrl, name) {
    if (!mesh) return;
    const loader = new MMDLoader();

    try {
        const clip = await new Promise((resolve, reject) => {
            loader.loadAnimation(vmdUrl, mesh, (anim) => resolve(anim), undefined, (e) => reject(e));
        });

        helper.add(mesh, { animation: clip, physics: false });
        currentMotionName = name;
        console.log('VMD 加载完成:', name);
    } catch (e) {
        console.error('VMD 加载失败:', e);
    }
}

window.mmdPlayMotion = function(name) {
    if (!mesh || !helper) return;
    const basePath = MMD_MODEL_BASE + (window._currentMMDCharId || '') + '/';
    const vmdFile = name.endsWith('.vmd') ? name : name + '.vmd';
    loadVMD(basePath + vmdFile, name);
};

window.mmdFlipModel = function() {
    if (!mesh) return;
    mesh.scale.x *= -1;
};

window.mmdSetScale = function(scale) {
    if (!mesh || !camera) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    camera.position.set(0, center.y, Math.max(size.y * 1.5, 20) / scale);
    camera.lookAt(0, center.y, 0);
};
