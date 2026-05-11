# ArkDock

macOS 桌面伴侣 — 让明日方舟干员陪你工作。

<!-- screenshot -->

## 功能

- **Spine 骨骼动画** — 角色在桌面上播放战斗/基建/待机动画
- **多皮肤/多模式** — 支持角色的所有皮肤和正面/背面/基建视图
- **AI 对话** — 每个角色有独立人格 (system prompt)，支持 OpenAI 兼容 API
- **语音台词** — 中文/日文语音播放，点击角色随机触发
- **技能展示** — 技能图标 + 释放动画 + 台词联动
- **闲置聊天** — 角色会自己说话（从语音台词库随机选取）
- **轻量透明** — 无边框置顶窗口，支持点击穿透

## 系统要求

- macOS 15.0+
- Swift 6.0+

## 构建 & 运行

```bash
# 克隆
git clone https://github.com/mikufanliu/arkdock.git
cd arkdock

# 导入你的第一个角色
python3 add_character.py 玛恩纳

# 构建运行
cd ArkDock
swift run
```

## 导入角色

使用 `add_character.py` 从 PRTS Wiki 自动下载角色数据：

```bash
# 基本用法
python3 add_character.py 玛恩纳

# 指定输出目录
python3 add_character.py 维什戴尔 --dir wisdel

# 手动指定角色代码
python3 add_character.py 凯尔希·思衡托 --dir kaltsit --code char_1052_kalts2

# 选择语音语言 (cn=中文, jp=日语, dialect=方言)
python3 add_character.py 陈 --lang dialect

# 导入敌人/Boss
python3 add_character.py 霜星
```

脚本会自动完成：
1. 解析 PRTS Wiki 角色信息
2. 下载 Spine 模型（所有皮肤）
3. 下载语音文件
4. 抓取技能信息 + 图标
5. 匹配技能动画
6. 生成 AI 人格 (persona.json)

## AI 对话配置

在 app 侧边栏「设置」中配置 LLM：

- **Endpoint**: OpenAI 兼容的 API 地址（如 `https://api.openai.com`）
- **API Key**: 你的 API 密钥
- **Model**: 模型名称（如 `gpt-4o`、`claude-sonnet-4-6`）

未配置 API 时，角色会使用脚本模式（从语音台词中随机选取回复）。

### add_character.py 的 AI 总结

导入角色时，脚本可以用 LLM 总结角色档案生成更好的人格提示词：

```bash
export ANTHROPIC_BASE_URL="https://api.openai.com"  # 或其他 OpenAI 兼容端点
export ANTHROPIC_AUTH_TOKEN="sk-xxx"
export LLM_MODEL="gpt-4o"  # 可选，默认 claude-sonnet-4-6
python3 add_character.py 斯卡蒂
```

未设置环境变量时自动回退到原文截取模式。

## 项目结构

```
arkdock/
├── ArkDock/              # Swift macOS app
│   ├── Package.swift
│   └── Sources/
│       ├── ArkDockApp.swift      # 入口 + MenuBar
│       ├── PetState.swift        # 全局状态管理
│       ├── PetWindowView.swift   # UI 视图
│       ├── ChatEngine.swift      # AI 对话引擎
│       ├── LLMProvider.swift     # LLM API 调用
│       └── ...
├── web/                  # WebView 渲染层
│   ├── spine.html/js     # Spine 动画渲染
│   ├── lib/              # pixi.js + pixi-spine
│   └── model/            # 角色数据 (gitignored)
├── add_character.py      # 角色导入脚本
└── README.md
```

## 免责声明

本项目为同人/学习交流项目。
明日方舟(Arknights)相关素材（包括但不限于角色模型、语音、图标）的版权归上海鹰角网络科技有限公司所有。
本项目不包含任何游戏素材文件，所有角色数据需用户自行通过脚本从公开 Wiki 获取。
如有侵权请联系删除。

## License

[MIT](LICENSE)
