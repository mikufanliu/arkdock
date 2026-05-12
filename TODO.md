# ArkDock - TODO

## Pending

- [ ] 代码签名 — 无签名 app 被 Gatekeeper 拦截，用户需右键打开
- [ ] 应用图标 — 当前无 .icns，需要设计一个 ArkDock logo
- [ ] 系统托盘快捷操作 — 右键菜单加入更多功能（切皮肤、技能快捷键）
- [ ] 多角色同屏 — 支持同时显示多个桌宠窗口
- [ ] 系统感知 — 检测用户活动状态，长时间不操作触发特殊对话
- [ ] 角色好感度持久化 — 当前 affection 不保存，重启归零

## Ideas

- [ ] 基建动画自动切换 — 长时间闲置自动切到基建模式
- [ ] 通知集成 — 角色播报系统通知（日历、消息等）
- [ ] 语音合成 — 用 TTS 读出 AI 回复而非静态音频
- [ ] 插件系统 — 允许社区贡献自定义交互脚本

## Done

- [x] Spine 骨骼动画渲染（pixi-spine）
- [x] 多皮肤/多模式切换（正面/背面/基建）
- [x] 角色导入脚本（add_character.py）— 自动从 PRTS Wiki 下载模型/语音/技能/档案
- [x] AI 人格系统 — LLM 总结档案生成 system prompt，per-character persona.json
- [x] 多 LLM Provider — OpenAI 兼容 API（Anthropic/DeepSeek/Azure）
- [x] ScriptedChatEngine — 无 API 时用台词库回复
- [x] 语音台词播放 — 中文/日文/方言多语种支持
- [x] 技能栏 — 图标 + 释放动画 + 台词联动
- [x] 闲置聊天 — 定时从台词池随机发言
- [x] 聊天历史持久化 — per-character 独立存储
- [x] GitHub Actions CI — 打 tag 自动构建 DMG 发 Release
- [x] 项目改名 AsukaPet → ArkDock，开源准备（LICENSE/README/清理）
- [x] Live2D 渲染（pixi-live2d-display + Cubism4）
- [x] MMD 模型支持（Three.js + MMDLoader）
- [x] SwiftUI 桌面应用（NSPanel + WKWebView）
- [x] 本地 HTTP Server（NWListener，解决 WASM/资源加载）
