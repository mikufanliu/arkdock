#!/usr/bin/env python3
"""
一键导入明日方舟角色/敌人到 Suzu 桌宠。

用法:
    python3 add_character.py 玛恩纳
    python3 add_character.py 维什戴尔 --dir wisdel
    python3 add_character.py 霜星，"冬痕" --dir froststar
    python3 add_character.py 凯尔希·思衡托 --dir kaltsit --code char_1052_kalts2

支持干员（多皮肤多模式）和敌人（单模型）。
自动完成：Spine 模型下载、语音抓取、技能图标下载、manifest/skills/voice_lines 生成。
"""

import argparse
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "web", "model")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://prts.wiki/",
}

PRTS_API = "https://prts.wiki/api.php"
CHAR_SPINE_BASE = "https://torappu.prts.wiki/assets/char_spine"
ENEMY_SPINE_BASE = "https://torappu.prts.wiki/assets/enemy_spine"
AUDIO_BASE = "https://torappu.prts.wiki/assets/audio"

LANG_VOICE_DIR = {
    "cn": "voice_cn",
    "jp": "voice",
    "dialect": "voice_custom",
}

MODE_MAP = {"正面": "front", "背面": "back", "基建": "build", "战斗": "front"}


# ============================================================
# Utility
# ============================================================

def fetch_url(url, timeout=15):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_json(url):
    return json.loads(fetch_url(url).decode("utf-8"))


def download_file(url, dest, quiet=False):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return True
    if not quiet:
        print(f"    ↓ {os.path.basename(dest)}")
    try:
        data = fetch_url(url, timeout=30)
        if len(data) > 100:
            with open(dest, "wb") as f:
                f.write(data)
            return True
    except Exception as e:
        if not quiet:
            print(f"      ✗ {e}")
    return False


# ============================================================
# Step 1: Resolve character info from PRTS wiki
# ============================================================

def _fetch_wikitext(name):
    """Fetch wikitext for a page, return None if not found."""
    encoded = urllib.parse.quote(name)
    url = f"{PRTS_API}?action=parse&page={encoded}&prop=wikitext&format=json"
    try:
        data = fetch_json(url)
        if "parse" in data:
            return data["parse"]["wikitext"]["*"]
    except Exception:
        pass
    return None


def resolve_character(name, manual_code=None):
    """Returns (char_code, char_type, wikitext, display_name)"""
    print(f"[1/7] 解析角色信息: {name}")

    wikitext = _fetch_wikitext(name)
    if wikitext is None:
        # Try replacing ASCII quotes with Chinese quotes
        alt_name = name.replace('"', '“', 1).replace('"', '”', 1)
        if alt_name != name:
            print(f"  重试: {alt_name}")
            wikitext = _fetch_wikitext(alt_name)
            if wikitext is not None:
                name = alt_name
    if wikitext is None:
        print(f"  ✗ 页面不存在")
        sys.exit(1)

    if manual_code:
        char_code = manual_code
    else:
        m = re.search(r"\|干员id=([^\|\}\n]+)", wikitext)
        if m:
            char_code = m.group(1).strip()
        else:
            char_code = None

    if char_code:
        print(f"  干员: {char_code}")
        return char_code, "operator", wikitext, name

    # Try enemy - look for enemy spine config in the full page HTML
    print("  不是干员，尝试敌人模型...")
    encoded = urllib.parse.quote(name)
    html_url = f"https://prts.wiki/w/{encoded}"
    try:
        html = fetch_url(html_url).decode("utf-8")
        m = re.search(r'"prefix"\s*:\s*"(https://torappu\.prts\.wiki/assets/enemy_spine/([^/]+)/)"', html)
        if m:
            enemy_id = m.group(2)
            print(f"  敌人: {enemy_id}")
            return enemy_id, "enemy", wikitext, name
    except Exception:
        pass

    print("  ✗ 找不到角色代码或敌人模型")
    sys.exit(1)


def derive_dir_name(char_code, char_type):
    """Derive output directory name from char_code."""
    if char_type == "enemy":
        # enemy_1510_frstar2 -> frstar2
        parts = char_code.split("_")
        return parts[-1] if len(parts) > 2 else char_code

    # char_4064_mlynar -> mlynar
    parts = char_code.split("_")
    short = parts[-1] if len(parts) >= 3 else char_code
    # Known mappings
    known = {"kalts2": "kaltsit", "kalts": "kaltsit_og"}
    return known.get(short, short)


# ============================================================
# Step 2: Download Spine models
# ============================================================

def download_spine_operator(char_code, output_dir):
    """Download all skins/modes for an operator."""
    meta_url = f"{CHAR_SPINE_BASE}/{char_code}/meta.json"
    print(f"\n[2/7] 下载 Spine 模型")
    print(f"  meta: {meta_url}")

    try:
        meta = fetch_json(meta_url)
    except Exception as e:
        print(f"  ✗ 获取 meta.json 失败: {e}")
        return None

    prefix = meta["prefix"]
    skins_info = []

    for skin_name, groups in meta["skin"].items():
        modes_info = []
        for mode_name, info in groups.items():
            file_path = info["file"]
            mode_key = MODE_MAP.get(mode_name, mode_name)

            # Derive directory name from file path
            # e.g., "char_4064_mlynar_epoque_28/front/char_4064_mlynar_epoque_28"
            path_parts = file_path.split("/")
            if len(path_parts) >= 2:
                skin_dir_part = path_parts[0]
                # Use skin directory + mode as our local dir name
                if skin_dir_part == "defaultskin":
                    dir_name = f"default_{mode_key}"
                else:
                    # Extract skin suffix: char_4064_mlynar_epoque_28 -> epoque_28
                    suffix = skin_dir_part.replace(char_code + "_", "")
                    dir_name = f"{suffix}_{mode_key}"
            else:
                dir_name = f"{skin_name}_{mode_key}"

            dest_dir = os.path.join(output_dir, dir_name)
            print(f"  [{skin_name}/{mode_name}] → {dir_name}/")

            _download_spine_files(prefix, file_path, dest_dir)
            modes_info.append({"name": mode_name, "path": dir_name})

        skins_info.append({"name": skin_name, "modes": modes_info})

    return {"name": meta.get("name", ""), "skins": skins_info}


def download_spine_enemy(enemy_id, output_dir):
    """Download single enemy spine model."""
    prefix = f"{ENEMY_SPINE_BASE}/{enemy_id}/"
    print(f"\n[2/7] 下载敌人 Spine 模型")
    print(f"  prefix: {prefix}")

    dest_dir = os.path.join(output_dir, "front")
    _download_spine_files(prefix, enemy_id, dest_dir)

    return {"name": "", "skins": [{"name": "默认", "modes": [{"name": "默认", "path": "front"}]}]}


def _download_spine_files(prefix, file_path, dest_dir):
    """Download .skel + .atlas + textures for one model variant."""
    os.makedirs(dest_dir, exist_ok=True)
    base_name = file_path.split("/")[-1]
    base_url = prefix + file_path

    # Download .skel
    download_file(base_url + ".skel", os.path.join(dest_dir, base_name + ".skel"))

    # Download .atlas
    atlas_path = os.path.join(dest_dir, base_name + ".atlas")
    download_file(base_url + ".atlas", atlas_path)

    # Parse atlas for texture filenames
    if os.path.exists(atlas_path):
        with open(atlas_path, "r") as f:
            atlas_content = f.read()
        dir_prefix = "/".join(file_path.split("/")[:-1])
        for line in atlas_content.split("\n"):
            line = line.strip()
            if line.endswith(".png"):
                png_url = prefix + (dir_prefix + "/" + line if dir_prefix else line)
                download_file(png_url, os.path.join(dest_dir, line))

    fix_texture_sizes(dest_dir)


def fix_texture_sizes(dest_dir):
    """Fix PRTS compressed textures to match atlas-declared sizes."""
    try:
        from PIL import Image
    except ImportError:
        return

    for fname in os.listdir(dest_dir):
        if not fname.endswith(".atlas"):
            continue
        with open(os.path.join(dest_dir, fname)) as f:
            content = f.read()

        png_name = None
        for line in content.split("\n"):
            line = line.strip()
            if line.endswith(".png"):
                png_name = line
            m = re.match(r"size:\s*(\d+),(\d+)", line)
            if m and png_name:
                w, h = int(m.group(1)), int(m.group(2))
                png_path = os.path.join(dest_dir, png_name)
                if os.path.exists(png_path):
                    img = Image.open(png_path)
                    if img.size != (w, h):
                        print(f"    修复贴图: {png_name} {img.size[0]}x{img.size[1]} → {w}x{h}")
                        img.resize((w, h), Image.LANCZOS).save(png_path)
                png_name = None


# ============================================================
# Step 3: Generate manifest.json
# ============================================================

def generate_manifest(display_name, skins_info, output_dir):
    """Generate manifest.json from skin/mode info."""
    print(f"\n[3/7] 生成 manifest.json")

    manifest = {
        "name": display_name,
        "type": "spine",
        "skins": []
    }

    for skin in skins_info:
        modes = [{"name": m["name"], "path": m["path"]} for m in skin["modes"]]
        # Translate mode names to Chinese display names
        for mode in modes:
            name = mode["name"]
            if name == "正面":
                mode["name"] = "战斗(正面)"
            elif name == "背面":
                mode["name"] = "战斗(背面)"
            elif name == "基建":
                mode["name"] = "基建"
        manifest["skins"].append({"name": skin["name"], "modes": modes})

    path = os.path.join(output_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"  → {path}")
    return manifest


# ============================================================
# Step 4: Download voice lines
# ============================================================

TITLE_KEY_MAP = {
    "任命助理": "assign", "闲置": "idle", "干员报到": "onboard",
    "戳一下": "poke", "信赖触摸": "trust_touch", "问候": "greeting", "标题": "title",
}


def title_to_key(title):
    if title in TITLE_KEY_MAP:
        return TITLE_KEY_MAP[title]
    m = re.match(r"交谈(\d+)", title)
    if m:
        return f"talk{m.group(1)}"
    m = re.match(r"晋升后交谈(\d+)", title)
    if m:
        return f"promotion_talk{m.group(1)}"
    m = re.match(r"信赖提升后交谈(\d+)", title)
    if m:
        return f"trust_talk{m.group(1)}"
    return title


class VoiceLineParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.voice_lines = []
        self.current_title = None
        self.current_filename = None
        self.in_cn_detail = False
        self.current_content = ""
        self.char_code = None
        self.voice_base_cn = None

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if tag == "div":
            cls = d.get("class", "")
            div_id = d.get("id", "")
            if "voice-data-root" in cls or div_id == "voice-data-root":
                self.char_code = d.get("data-voice-key", "")
                voice_base = d.get("data-voice-base", "")
                for part in voice_base.split(","):
                    if "中文-普通话:" in part:
                        self.voice_base_cn = part.split(":", 1)[1]
                        break
            elif "voice-data-item" in cls:
                self.current_title = d.get("data-title", "")
                self.current_filename = d.get("data-voice-filename", "")
            elif "voice-item-detail" in cls:
                if d.get("data-kind-name") == "中文":
                    self.in_cn_detail = True
                    self.current_content = ""

    def handle_endtag(self, tag):
        if tag == "div" and self.in_cn_detail:
            self.in_cn_detail = False
            if self.current_title is not None:
                self.voice_lines.append({
                    "key": title_to_key(self.current_title),
                    "title": self.current_title,
                    "content": self.current_content.strip(),
                    "filename": self.current_filename or "",
                })
                self.current_title = None
                self.current_filename = None

    def handle_data(self, data):
        if self.in_cn_detail:
            self.current_content += data


def download_voice_lines(display_name, char_code, output_dir, lang="cn"):
    """Download voice lines and audio files."""
    print(f"\n[4/7] 下载语音台词 (语言: {lang})")

    encoded_name = urllib.parse.quote(display_name)
    voice_url = f"https://prts.wiki/w/{encoded_name}/{urllib.parse.quote('语音记录')}"
    print(f"  页面: {voice_url}")

    try:
        html = fetch_url(voice_url).decode("utf-8")
    except Exception as e:
        print(f"  ✗ 语音页面获取失败: {e}")
        return

    parser = VoiceLineParser()
    parser.feed(html)

    voice_char_code = parser.char_code or char_code
    print(f"  voice_key: {voice_char_code}")
    print(f"  台词数: {len(parser.voice_lines)}")

    # Resolve voice path from parsed voice-base
    voice_path_prefix = None
    if parser.voice_base_cn and lang == "cn":
        voice_path_prefix = parser.voice_base_cn
    elif lang == "dialect":
        # Look for 中文-方言 in the raw HTML
        m = re.search(r'data-voice-base="([^"]+)"', html)
        if m:
            bases = m.group(1).replace("&#95;", "_")
            for part in bases.split(","):
                if "中文-方言" in part:
                    voice_path_prefix = part.split(":", 1)[1]
                    break
        if not voice_path_prefix:
            print("  ⚠ 该角色无方言语音，回退到普通话")
            voice_path_prefix = parser.voice_base_cn or f"voice_cn/{voice_char_code}"
    if not voice_path_prefix:
        voice_dir = LANG_VOICE_DIR.get(lang, "voice_cn")
        voice_path_prefix = f"{voice_dir}/{voice_char_code}"
    print(f"  音频路径: {voice_path_prefix}")

    audio_dir = os.path.join(output_dir, "voice")
    os.makedirs(audio_dir, exist_ok=True)

    voice_lines_out = []
    success = 0
    for line in parser.voice_lines:
        entry = {
            "key": line["key"],
            "title": line["title"],
            "content": line["content"],
        }
        if line["filename"]:
            audio_file = line["filename"].lower()
            entry["audioFile"] = audio_file
            url = f"{AUDIO_BASE}/{voice_path_prefix}/{audio_file}"
            dest = os.path.join(audio_dir, audio_file)
            if download_file(url, dest, quiet=True):
                success += 1
            time.sleep(0.1)
        voice_lines_out.append(entry)

    result = {"name": display_name, "voiceLines": voice_lines_out}
    json_path = os.path.join(output_dir, "voice_lines.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"  ✓ {success}/{len(parser.voice_lines)} 音频下载成功")
    print(f"  → {json_path}")


# ============================================================
# Step 5: Fetch skill info
# ============================================================

def fetch_skills(display_name, wikitext, output_dir):
    """Extract skill names from wikitext and download icons."""
    print(f"\n[5/7] 抓取技能信息")

    # Try multiple patterns for skill names
    skills = []

    # Pattern 1: |技能名=xxx (most common, appears multiple times in order)
    skills = re.findall(r"\|技能名=([^\|\}\n]+)", wikitext)

    # Pattern 2: |技能名N=xxx (alternative format)
    if not skills:
        for i in range(1, 4):
            m = re.search(rf"\|技能名{i}=([^\|\}}\n]+)", wikitext)
            if m:
                skills.append(m.group(1).strip())

    if not skills:
        print("  ✗ 未找到技能名")
        return []

    print(f"  技能: {skills}")

    # Download skill icons
    skills_dir = os.path.join(output_dir, "skills")
    os.makedirs(skills_dir, exist_ok=True)

    for i, skill_name in enumerate(skills, 1):
        icon_path = os.path.join(skills_dir, f"skill_{i}.png")
        if os.path.exists(icon_path):
            print(f"  ✓ skill_{i}.png (已存在)")
            continue

        # Query MediaWiki for file URL
        encoded_title = urllib.parse.quote(f"File:技能 {skill_name}.png")
        api_url = f"{PRTS_API}?action=query&titles={encoded_title}&prop=imageinfo&iiprop=url&format=json"
        try:
            data = fetch_json(api_url)
            pages = data["query"]["pages"]
            for page in pages.values():
                if "imageinfo" in page:
                    img_url = page["imageinfo"][0]["url"]
                    if download_file(img_url, icon_path):
                        print(f"  ✓ skill_{i}.png")
                    break
            else:
                print(f"  ✗ skill_{i}.png (图标不存在)")
        except Exception as e:
            print(f"  ✗ skill_{i}.png ({e})")

    return skills


# ============================================================
# Step 6: Match skill animations from .skel
# ============================================================

def extract_animations_from_skel(output_dir):
    """Extract animation names from the default_front .skel file using Playwright."""
    # Find default front skel
    front_dir = os.path.join(output_dir, "default_front")
    if not os.path.isdir(front_dir):
        # Try just "front" for enemies
        front_dir = os.path.join(output_dir, "front")
    if not os.path.isdir(front_dir):
        return []

    skel_files = [f for f in os.listdir(front_dir) if f.endswith(".skel")]
    if not skel_files:
        return []

    skel_name = skel_files[0].replace(".skel", "")
    rel_path = os.path.relpath(front_dir, os.path.join(BASE_DIR, "web"))

    # Try using Playwright for reliable animation extraction
    try:
        return _extract_anims_playwright(rel_path, skel_name)
    except Exception as e:
        print(f"  Playwright 不可用 ({e})，使用二进制提取")
        return _extract_anims_binary(os.path.join(front_dir, skel_files[0]))


def _extract_anims_playwright(model_rel_path, skel_name):
    """Use headless browser to load spine and get animation names."""
    import subprocess
    import tempfile

    web_dir = os.path.join(BASE_DIR, "web")
    html_content = f"""<!DOCTYPE html>
<html><head>
<script src="lib/pixi.min.js"></script>
<script src="lib/pixi-spine.umd.js"></script>
</head><body><pre id="out">loading</pre><script>
const app = new PIXI.Application({{width:100,height:100,backgroundAlpha:0}});
const loader = new PIXI.Loader();
loader.add("m", "{model_rel_path}/{skel_name}.skel", {{
    metadata: {{spineAtlasFile: "{model_rel_path}/{skel_name}.atlas"}},
    xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER
}});
loader.load((_,res) => {{
    const r = res["m"];
    if (!r||!r.spineData) {{ document.getElementById("out").textContent="FAILED"; return; }}
    const anims = r.spineData.animations.map(a=>a.name);
    const h = r.spineData.height;
    document.getElementById("out").textContent = JSON.stringify({{anims,height:h}});
}});
</script></body></html>"""

    test_path = os.path.join(web_dir, "_test_anims.html")
    with open(test_path, "w") as f:
        f.write(html_content)

    # Start server and run playwright
    import subprocess as sp
    server = sp.Popen(["python3", "-m", "http.server", "9878"], cwd=web_dir,
                      stdout=sp.DEVNULL, stderr=sp.DEVNULL)
    time.sleep(0.5)

    try:
        script = """
const {chromium} = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:9878/_test_anims.html');
    await page.waitForFunction(() => !document.getElementById('out').textContent.includes('loading'), {timeout:10000});
    console.log(await page.textContent('#out'));
    await browser.close();
})();
"""
        result = sp.run(["node", "-e", script], capture_output=True, text=True,
                       timeout=15, cwd="/tmp")
        output = result.stdout.strip()
        if output and output != "FAILED":
            data = json.loads(output)
            return data.get("anims", [])
    except Exception:
        pass
    finally:
        server.terminate()
        server.wait()
        os.remove(test_path)

    return []


def _extract_anims_binary(skel_path):
    """Fallback: extract animation-like strings from skel binary."""
    with open(skel_path, "rb") as f:
        data = f.read()

    # Find ASCII strings that look like animation names
    strings = re.findall(rb"[A-Z][a-zA-Z0-9_]{3,30}", data)
    candidates = set()
    for s in strings:
        name = s.decode("ascii")
        if any(k in name for k in ["Idle", "Skill", "Attack", "Start", "Die", "Stun", "Default"]):
            candidates.add(name)
    return sorted(candidates)


def match_skill_animations(animations):
    """Match Skill_N patterns from animation list."""
    skill_anims = []
    for n in range(1, 4):
        # Priority: Skill_N_Start > Skill_N_Begin > Skill_N
        patterns = [
            f"Skill_{n}_Start",
            f"Skill_{n}_Begin",
            f"Skill_{n}",
        ]
        found = None
        for pat in patterns:
            if pat in animations:
                found = pat
                break
        # Fallback: fuzzy match with suffix
        if not found:
            for anim in animations:
                if re.match(rf"Skill_{n}(_Start|_Begin)?$", anim, re.IGNORECASE):
                    found = anim
                    break
        skill_anims.append(found)

    # If no numbered skills found, fall back to generic Skill_Start/Skill_Begin
    if all(a is None for a in skill_anims):
        generic = None
        for pat in ["Skill_Start", "Skill_Begin", "Skill"]:
            if pat in animations:
                generic = pat
                break
        if generic:
            skill_anims = [generic] * len(skill_anims)

    return skill_anims


# ============================================================
# Step 7: Generate skills.json
# ============================================================

def generate_skills_json(display_name, skill_names, skill_anims, output_dir):
    """Generate skills.json with matched animations."""
    print(f"\n[7/7] 生成 skills.json")

    # Load voice lines for skill quotes
    voice_lines_path = os.path.join(output_dir, "voice_lines.json")
    battle_lines = []
    if os.path.exists(voice_lines_path):
        with open(voice_lines_path, "r", encoding="utf-8") as f:
            vl_data = json.load(f)
            for vl in vl_data.get("voiceLines", []):
                key = vl.get("key", "")
                if key.startswith("作战中"):
                    battle_lines.append(vl.get("content", ""))

    skills = []
    for i, name in enumerate(skill_names):
        anim = skill_anims[i] if i < len(skill_anims) else None
        voice = battle_lines[i] if i < len(battle_lines) else ""
        skills.append({
            "name": name,
            "description": "",
            "icon": f"skills/skill_{i+1}.png",
            "animation": anim or "",
            "voiceLine": voice,
            "audioFile": f"cn_{25+i:03d}.wav",
        })

    result = {"name": display_name, "skills": skills}
    path = os.path.join(output_dir, "skills.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  → {path}")

    for s in skills:
        status = "✓" if s["animation"] else "?"
        print(f"  {status} {s['name']}: animation={s['animation'] or '未匹配'}")


# ============================================================
# Step 8: Generate persona.json
# ============================================================

PERSONA_VOICE_KEYS = {
    "idle": "idleLines",
    "poke": "tapLines",
    "trust_touch": "tapLines",
}

PERSONA_KEYWORD_KEYS = ["assign", "talk1", "talk2", "talk3",
                        "trust_talk1", "trust_talk2", "trust_talk3",
                        "promotion_talk1", "promotion_talk2"]


def scrape_archives(display_name):
    """Fetch operator archive texts from PRTS wiki."""
    encoded = urllib.parse.quote(display_name)
    url = f"{PRTS_API}?action=query&titles={encoded}&prop=revisions&rvprop=content&format=json"
    try:
        data = fetch_json(url)
        pages = data["query"]["pages"]
        page = list(pages.values())[0]
        wikitext = page["revisions"][0]["*"]
    except Exception as e:
        print(f"  ⚠ 档案获取失败: {e}")
        return []

    archives = re.findall(r"\|档案(\d+)文本=(.*?)(?=\n\|档案\d|$)", wikitext, re.DOTALL)
    results = []
    for num, text in archives:
        text = text.strip()
        text = re.sub(r"<.*?>", "", text)
        if text:
            results.append((int(num), text))
    return results


LLM_ENDPOINT = os.environ.get("ANTHROPIC_BASE_URL", "")
LLM_API_KEY = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "claude-sonnet-4-6")


def _call_llm(system, user_msg):
    """Call LLM API (OpenAI-compatible) and return response text."""
    url = f"{LLM_ENDPOINT}/v1/chat/completions"
    body = json.dumps({
        "model": LLM_MODEL,
        "max_tokens": 1024,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {LLM_API_KEY}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"  ⚠ LLM 调用失败: {e}")
        return None


def build_system_prompt(display_name, archives, voice_lines):
    """Build a character system prompt from archives and voice lines."""
    archive_text = ""
    for num, text in archives:
        archive_text += f"【档案{num}】\n{text}\n\n"

    talk_samples = []
    for vl in voice_lines:
        if vl.get("key") in PERSONA_KEYWORD_KEYS:
            talk_samples.append(f"- {vl['title']}: 「{vl['content']}」")

    summarize_prompt = f"""请为明日方舟角色「{display_name}」生成一段角色扮演 system prompt（中文），要求：

1. 先用2-3句话概括角色身份、背景、与博士的关系
2. 总结性格特征（3-5个关键词+具体表现）
3. 说话风格（语气、用词习惯、口癖、常用句式）
4. 情感态度（对博士的态度、内心想法）
5. 最后加上行为约束（简短回复、不说自己是AI、称呼博士等）

总长度控制在400-600字。不要照搬原文，提炼精华。"""

    user_content = f"## 档案资料\n{archive_text[:3000]}"
    if talk_samples:
        user_content += f"\n## 语音台词示例\n" + "\n".join(talk_samples[:10])

    if LLM_API_KEY and LLM_ENDPOINT:
        print("  调用 LLM 总结角色人格...")
        result = _call_llm(summarize_prompt, user_content)
        if result:
            print(f"  ✓ AI 总结完成 ({len(result)} 字)")
            return result

    print("  ⚠ 无 LLM 配置，使用原文截取模式")
    return _build_system_prompt_fallback(display_name, archives, voice_lines)


def _build_system_prompt_fallback(display_name, archives, voice_lines):
    """Fallback: build prompt by truncating raw archives."""
    prompt_parts = []
    prompt_parts.append(f"你是{display_name}，来自明日方舟世界（泰拉大陆），现在作为罗德岛干员与博士（用户）对话。")
    prompt_parts.append("")

    prompt_parts.append("## 角色设定")
    for num, text in archives[:4]:
        if num <= 2:
            prompt_parts.append(text)
        else:
            prompt_parts.append(text[:300])
    prompt_parts.append("")

    if len(archives) > 4:
        prompt_parts.append("## 深层性格与经历")
        for num, text in archives[4:]:
            prompt_parts.append(text[:200])
        prompt_parts.append("")

    talk_lines = []
    for vl in voice_lines:
        if vl.get("key") in PERSONA_KEYWORD_KEYS:
            talk_lines.append(f"- {vl['title']}: 「{vl['content']}」")
    if talk_lines:
        prompt_parts.append("## 说话风格参考（模仿这种语气和用词习惯）")
        prompt_parts.append("\n".join(talk_lines[:8]))
        prompt_parts.append("")

    prompt_parts.append("## 要求")
    prompt_parts.append("- 用中文回复，保持角色性格一致")
    prompt_parts.append("- 回复简短自然（1-3句话为主），像日常闲聊")
    prompt_parts.append("- 不要自称'我是AI'，你就是这个角色")
    prompt_parts.append("- 称呼用户为'博士'")
    prompt_parts.append("- 可以适当用省略号、感叹号等体现性格")

    return "\n".join(prompt_parts)


def generate_persona(display_name, output_dir):
    """Generate persona.json for a character."""
    print(f"\n[8] 生成 persona.json")

    archives = scrape_archives(display_name)
    print(f"  档案数: {len(archives)}")

    voice_lines_path = os.path.join(output_dir, "voice_lines.json")
    voice_lines = []
    if os.path.exists(voice_lines_path):
        with open(voice_lines_path, "r", encoding="utf-8") as f:
            vl_data = json.load(f)
            voice_lines = vl_data.get("voiceLines", [])

    system_prompt = build_system_prompt(display_name, archives, voice_lines)

    idle_lines = []
    tap_lines = []
    talk_lines = []

    for vl in voice_lines:
        key = vl.get("key", "")
        content = vl.get("content", "")
        if not content:
            continue
        if key == "idle":
            idle_lines.append(content)
        elif key in ("poke", "trust_touch"):
            tap_lines.append(content)
        elif key.startswith("talk") or key.startswith("trust_talk"):
            talk_lines.append(content)

    greeting = ""
    for vl in voice_lines:
        if vl.get("key") == "onboard":
            greeting = vl["content"]
            break
    if not greeting:
        for vl in voice_lines:
            if vl.get("key") == "assign":
                greeting = vl["content"]
                break

    time_greetings = {}
    for vl in voice_lines:
        key = vl.get("key", "")
        if "morning" in key or key == "早上好":
            time_greetings["morning"] = vl["content"]
        elif "night" in key or key == "晚安":
            time_greetings["night"] = vl["content"]

    if not time_greetings.get("morning") and talk_lines:
        time_greetings["morning"] = "......早。"
    if not time_greetings.get("night") and talk_lines:
        time_greetings["night"] = "......该休息了。"

    # Extract profession from wikitext
    profession = ""
    sub_profession = ""
    try:
        encoded = urllib.parse.quote(display_name)
        wiki_url = f"{PRTS_API}?action=query&titles={encoded}&prop=revisions&rvprop=content&format=json"
        wiki_data = fetch_json(wiki_url)
        pages = wiki_data["query"]["pages"]
        page = list(pages.values())[0]
        wt = page["revisions"][0]["*"]
        prof_match = re.search(r"\|职业=([^\|\}\n]+)", wt)
        if prof_match:
            profession = prof_match.group(1).strip()
        sub_match = re.search(r"\|分支=([^\|\}\n]+)", wt)
        if sub_match:
            sub_profession = sub_match.group(1).strip()
    except Exception:
        pass

    archive_entries = [{"title": f"档案{num}", "content": text} for num, text in archives]

    persona = {
        "name": display_name,
        "greeting": greeting,
        "personality": _infer_personality(archives, voice_lines),
        "systemPrompt": system_prompt,
        "idleLines": idle_lines or ["......"],
        "tapLines": tap_lines or ["......什么事。"],
        "talkLines": talk_lines,
        "timeGreetings": {
            "morning": time_greetings.get("morning", "早。"),
            "afternoon": "嗯。",
            "evening": time_greetings.get("night", "......该休息了。"),
            "night": time_greetings.get("night", "......还不睡？"),
        },
        "archives": archive_entries,
        "profession": profession,
        "subProfession": sub_profession,
    }

    persona_path = os.path.join(output_dir, "persona.json")
    with open(persona_path, "w", encoding="utf-8") as f:
        json.dump(persona, f, ensure_ascii=False, indent=2)
    print(f"  ✓ persona.json (prompt: {len(system_prompt)} 字)")
    return persona


def _infer_personality(archives, voice_lines):
    """Simple personality description from archive text."""
    if not archives:
        return "沉默寡言"
    text = " ".join(t for _, t in archives[:3])
    traits = []
    if "沉默" in text or "寡言" in text:
        traits.append("沉默寡言")
    if "傲" in text or "自信" in text:
        traits.append("自信")
    if "冷" in text or "疏离" in text:
        traits.append("冷峻")
    if "温" in text or "关心" in text:
        traits.append("温和")
    if "严" in text or "纪律" in text:
        traits.append("严肃")

    if not traits:
        idle = next((v["content"] for v in voice_lines if v.get("key") == "idle"), "")
        if "......" in idle:
            traits.append("沉默寡言")
        else:
            traits.append("性格稳重")
    return "、".join(traits)


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="一键导入明日方舟角色到 Suzu 桌宠")
    parser.add_argument("name", help="PRTS wiki 页面名（中文）")
    parser.add_argument("--dir", help="输出目录名（默认自动推导）")
    parser.add_argument("--code", help="手动指定 char_code")
    parser.add_argument("--skip-voice", action="store_true", help="跳过语音下载")
    parser.add_argument("--skip-skills", action="store_true", help="跳过技能抓取")
    parser.add_argument("--lang", default="cn", choices=["cn", "jp", "dialect"],
                        help="语音语言: cn=中文普通话, jp=日语, dialect=中文方言 (默认: cn)")
    args = parser.parse_args()

    # Step 1: Resolve character
    char_code, char_type, wikitext, display_name = resolve_character(args.name, args.code)

    # Determine output directory
    dir_name = args.dir or derive_dir_name(char_code, char_type)
    output_dir = os.path.join(MODEL_DIR, dir_name)
    os.makedirs(output_dir, exist_ok=True)
    print(f"  输出目录: web/model/{dir_name}/")

    # Step 2: Download spine models
    if char_type == "operator":
        skins_info = download_spine_operator(char_code, output_dir)
    else:
        skins_info = download_spine_enemy(char_code, output_dir)

    if not skins_info:
        print("\n✗ 模型下载失败")
        sys.exit(1)

    # Step 3: Generate manifest
    manifest_name = skins_info.get("name") or display_name if isinstance(skins_info, dict) else display_name
    if isinstance(skins_info, dict):
        skins_list = skins_info["skins"]
    else:
        skins_list = skins_info
    generate_manifest(display_name, skins_list, output_dir)

    # Step 4: Download voice lines
    if not args.skip_voice:
        download_voice_lines(display_name, char_code, output_dir, lang=args.lang)
    else:
        print("\n[4/7] 跳过语音下载")

    # Step 5-7: Skills
    if not args.skip_skills and char_type == "operator":
        skill_names = fetch_skills(display_name, wikitext, output_dir)

        if skill_names:
            # Step 6: Extract and match animations
            print(f"\n[6/7] 匹配技能动画")
            animations = extract_animations_from_skel(output_dir)
            if animations:
                print(f"  动画列表: {', '.join(animations)}")
            else:
                print("  ⚠ 无法提取动画列表")
            skill_anims = match_skill_animations(animations)

            # Step 7: Generate skills.json
            generate_skills_json(display_name, skill_names, skill_anims, output_dir)
        else:
            print("\n[6/7] 跳过（无技能）")
            print("\n[7/7] 跳过（无技能）")
    else:
        print("\n[5/7] 跳过技能抓取")
        print("[6/7] 跳过")
        print("[7/7] 跳过")

    # Step 8: Generate persona
    if char_type == "operator":
        generate_persona(display_name, output_dir)

    # Summary
    print(f"\n{'='*50}")
    print(f"✓ 导入完成: {display_name}")
    print(f"  目录: web/model/{dir_name}/")
    print(f"  类型: {char_type}")

    # List generated files
    files = [f for f in os.listdir(output_dir) if os.path.isfile(os.path.join(output_dir, f))]
    dirs = [d for d in os.listdir(output_dir) if os.path.isdir(os.path.join(output_dir, d))]
    print(f"  文件: {', '.join(sorted(files))}")
    print(f"  模型: {', '.join(sorted(dirs))}")
    print(f"\n  重启 app 后即可在菜单中看到新角色。")


if __name__ == "__main__":
    main()
