#!/usr/bin/env python3
"""
测量所有 Spine 模型每个皮肤/模式的 setup pose 真实高度,
自动计算 displayScale + modeScales 使所有角色在屏幕上显示为统一大小。

用法: python3 calibrate_models.py
需要: pip install playwright && playwright install chromium
"""

import json
import os
import glob
import threading
import http.server
import socketserver

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "web", "model")


def start_http_server(port=9876):
    handler = http.server.SimpleHTTPRequestHandler
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


def measure_all_models():
    from playwright.sync_api import sync_playwright

    # Collect all skel files grouped by character
    chars = []
    for char_dir in sorted(glob.glob(os.path.join(MODEL_DIR, "*/"))):
        char_name = os.path.basename(char_dir.rstrip('/'))
        if char_name.startswith('.') or char_name == 'icons':
            continue
        manifest_path = os.path.join(char_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            continue
        with open(manifest_path, encoding='utf-8') as f:
            manifest = json.load(f)
        if manifest.get("type") != "spine":
            continue

        # Collect all mode paths and their skel files
        modes_to_measure = []
        for skin in manifest.get("skins", []):
            for mode in skin.get("modes", []):
                path = mode.get("path", "")
                mode_dir = os.path.join(char_dir, path)
                skels = glob.glob(os.path.join(mode_dir, "*.skel"))
                if skels:
                    skel_name = os.path.splitext(os.path.basename(skels[0]))[0]
                    sub_path = os.path.relpath(mode_dir, BASE_DIR)
                    modes_to_measure.append({
                        "path": path,
                        "skel_name": skel_name,
                        "sub_path": sub_path,
                    })

        if modes_to_measure:
            chars.append({
                "name": char_name,
                "modes": modes_to_measure,
                "manifest_path": manifest_path,
                "manifest": manifest,
            })

    if not chars:
        print("No spine models found")
        return

    total_modes = sum(len(c["modes"]) for c in chars)
    print(f"Found {len(chars)} characters, {total_modes} modes to calibrate")

    os.chdir(BASE_DIR)
    httpd = start_http_server(9876)
    print("HTTP server started on :9876")

    html = """<!DOCTYPE html>
<html><head>
<script src="http://127.0.0.1:9876/web/lib/pixi.min.js"></script>
<script src="http://127.0.0.1:9876/web/lib/pixi-spine.umd.js"></script>
</head><body>
<canvas id="c" width="800" height="800"></canvas>
<script>
const app = new PIXI.Application({view: document.getElementById('c'), width: 800, height: 800, backgroundAlpha: 0});

window.measureModel = function(skelUrl, atlasUrl) {
    return new Promise((resolve, reject) => {
        const loader = new PIXI.Loader();
        const id = 'model_' + Date.now() + '_' + Math.random();
        loader.add(id, skelUrl, {
            metadata: { spineAtlasFile: atlasUrl },
            xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER,
        });
        loader.load((_, resources) => {
            const res = resources[id];
            if (!res || !res.spineData) {
                reject('load failed');
                return;
            }
            const spine = new PIXI.spine.Spine(res.spineData);
            spine.skeleton.setToSetupPose();
            spine.skeleton.updateWorldTransform();
            spine.scale.set(1);
            const bounds = spine.getLocalBounds();
            const result = {
                width: bounds.width,
                height: bounds.height,
            };
            spine.destroy();
            loader.destroy();
            resolve(result);
        });
        loader.onError.add((e) => { loader.destroy(); reject(String(e)); });
    });
};
window.__ready = true;
</script></body></html>"""

    html_path = os.path.join(BASE_DIR, "_calibrate_tmp.html")
    with open(html_path, 'w') as f:
        f.write(html)

    # Measure all modes
    all_heights = []  # (char_name, mode_path, height)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://127.0.0.1:9876/_calibrate_tmp.html")
        page.wait_for_function("window.__ready === true", timeout=10000)

        for char in chars:
            print(f"  {char['name']}:")
            for mode_info in char["modes"]:
                skel_url = f"http://127.0.0.1:9876/{mode_info['sub_path']}/{mode_info['skel_name']}.skel"
                atlas_url = f"http://127.0.0.1:9876/{mode_info['sub_path']}/{mode_info['skel_name']}.atlas"
                try:
                    result = page.evaluate(f"""
                        async () => {{
                            try {{
                                return await window.measureModel("{skel_url}", "{atlas_url}");
                            }} catch(e) {{
                                return {{error: String(e)}};
                            }}
                        }}
                    """)
                    if "error" in result:
                        print(f"    {mode_info['path']:20} ERROR: {result['error']}")
                    else:
                        h = result['height']
                        all_heights.append((char['name'], mode_info['path'], h))
                        print(f"    {mode_info['path']:20} height={h:.1f}")
                except Exception as e:
                    print(f"    {mode_info['path']:20} EXCEPTION: {e}")

        browser.close()

    os.remove(html_path)
    httpd.shutdown()

    if not all_heights:
        print("No measurements collected")
        return

    # Use median of all front/battle modes as the global reference
    front_heights = [h for (_, path, h) in all_heights if "front" in path or "battle" in path]
    if not front_heights:
        front_heights = [h for (_, _, h) in all_heights]
    median_h = sorted(front_heights)[len(front_heights) // 2]
    print(f"\nMedian front height: {median_h:.1f}")
    print(f"\nResults:")

    # Group by character
    char_heights = {}
    for (char_name, mode_path, h) in all_heights:
        if char_name not in char_heights:
            char_heights[char_name] = {}
        char_heights[char_name][mode_path] = h

    for char in chars:
        name = char['name']
        if name not in char_heights:
            continue
        heights = char_heights[name]

        # Base displayScale from default_front (or first front mode)
        base_path = None
        for path in heights:
            if "default" in path and ("front" in path or "battle" in path):
                base_path = path
                break
        if not base_path:
            for path in heights:
                if "front" in path or "battle" in path:
                    base_path = path
                    break
        if not base_path:
            base_path = list(heights.keys())[0]

        base_height = heights[base_path]
        display_scale = round(median_h / base_height, 2)

        # modeScales: relative to base for each non-default mode
        mode_scales = {}
        for path, h in heights.items():
            if path == base_path:
                continue
            # This mode's ideal scale = median_h / h
            # Base scale already = median_h / base_height
            # So relative multiplier = (median_h / h) / (median_h / base_height) = base_height / h
            relative = round(base_height / h, 2)
            if abs(relative - 1.0) > 0.05:  # Only store if significantly different
                mode_scales[path] = relative

        manifest = char['manifest']
        manifest['displayScale'] = display_scale
        if mode_scales:
            manifest['modeScales'] = mode_scales
        elif 'modeScales' in manifest:
            del manifest['modeScales']

        print(f"  {name:12} base={base_path} displayScale={display_scale}")
        for path, s in mode_scales.items():
            print(f"    {path:20} modeScale={s}")

        with open(char['manifest_path'], 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("\n All manifests updated")


if __name__ == "__main__":
    measure_all_models()
