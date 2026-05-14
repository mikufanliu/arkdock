# ArkDock

跨平台桌面伴侣 — 让明日方舟干员陪你工作。

支持 macOS / Windows。

## 功能

- **Spine 骨骼动画** — 角色在桌面上播放战斗/基建/待机动画
- **Live2D 模型** — 支持 Cubism4 模型（表情 + 动作）
- **MMD 模型** — 支持 PMX/PMD 模型 + VMD 动作
- **多皮肤/多模式** — 支持角色的所有皮肤和正面/背面/基建视图
- **AI 对话** — 每个角色有独立人格，支持 OpenAI / DeepSeek / Kimi / Anthropic
- **多语言语音** — 中文/日文/方言语音播放
- **技能展示** — 技能图标 + 释放动画 + 台词联动
- **闲置聊天** — 角色会自己说话（语音台词随机触发）
- **轻量透明** — 无边框置顶窗口，支持点击穿透和拖拽

## 系统要求

- macOS 12.0+ (Apple Silicon / Intel) 或 Windows 10+
- Rust (开发时需要)

## 安装

从 [Releases](https://github.com/mikufanliu/arkdock/releases) 下载对应平台的安装包。

**macOS**: 打开 DMG，将 ArkDock.app 拖入 Applications。首次打开如提示"已损坏"，双击 DMG 中的「修复安全提示.command」脚本即可。

**Windows**: 运行 `.exe` 安装程序。

## 构建 & 运行

```bash
git clone https://github.com/mikufanliu/arkdock.git
cd arkdock

# 开发模式
cargo tauri dev

# 生产构建
cargo tauri build
```

生产构建会输出：
- macOS: `.dmg` 安装包
- Windows: `.msi` / NSIS `.exe` 安装包

## 导入角色

使用 `add_character.py` 从 PRTS Wiki 自动下载角色数据：

```bash
# 基本用法
python3 add_character.py 玛恩纳

# 指定输出目录
python3 add_character.py 维什戴尔 --dir wisdel

# 手动指定角色代码
python3 add_character.py 凯尔希·思衡托 --dir kaltsit2 --code char_1052_kalts2

# 选择语音语言 (默认全部下载)
python3 add_character.py 陈 --lang cn

# 导入敌人/Boss
python3 add_character.py 霜星
```

脚本自动完成：
1. 解析 PRTS Wiki 角色信息
2. 下载 Spine 模型（所有皮肤/模式）
3. 下载多语言语音文件
4. 抓取技能信息 + 图标
5. 匹配技能动画
6. 生成 AI 人格 (persona.json)

### 模型尺寸校准

导入后运行校准脚本，自动测量所有模型并统一显示大小：

```bash
pip install playwright && playwright install chromium
python3 calibrate_models.py
```

## AI 对话配置

在侧边面板「设置」tab 中配置 LLM：

- **Provider**: OpenAI / DeepSeek / Kimi / Anthropic / 自定义
- **API Key**: 你的 API 密钥
- **Model**: 模型名称（选择 Provider 后自动填充默认值）

未配置时，角色使用脚本模式（随机语音台词回复）。

## 项目结构

```
arkdock/
├── src-tauri/            # Rust 后端 (Tauri 2)
│   └── src/
│       ├── main.rs       # 入口 + 插件注册
│       ├── commands.rs   # Tauri 命令 (音频/文件/菜单)
│       └── tray.rs       # 系统托盘
├── src/                  # 前端 UI
│   ├── index.html
│   ├── app.js            # 面板/交互逻辑
│   ├── state.js          # 状态管理
│   ├── chat.js           # AI 对话引擎
│   └── style.css
├── web/                  # 渲染层
│   ├── spine.js          # Spine 渲染器
│   ├── live2d-tauri.js   # Live2D 渲染器
│   ├── mmd-tauri.js      # MMD 渲染器
│   ├── lib/              # pixi.js / three.js / spine / live2d
│   └── model/            # 角色数据
├── add_character.py      # 角色导入脚本
├── calibrate_models.py   # 模型尺寸校准
└── build-frontend.sh     # 生产构建前端组装
```

## 发布

推送 tag 触发 GitHub Actions 自动构建：

```bash
git tag v0.1.0
git push origin v0.1.0
```

会在 Releases 生成 macOS (.dmg) 和 Windows (.exe) 安装包。

## 数据来源

角色模型、语音、技能等数据来自 [PRTS Wiki](https://prts.wiki)（明日方舟社区 Wiki）。可通过 `add_character.py` 脚本自动导入更多角色。

## 免责声明

本项目为同人/学习交流项目，不以盈利为目的。
明日方舟相关素材版权归上海鹰角网络科技有限公司所有。
如有侵权请联系删除。

## License

[MIT](LICENSE)
