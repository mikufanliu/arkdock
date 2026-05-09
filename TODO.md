# Asuka Desktop Pet - TODO

## Pending

- [ ] 接入 MMD 模型：用 Three.js + MMDLoader 替代 Live2D，可用免费初音 MMD 模型（TDA 式等），改动在 web 层，Swift 端基本不用动

## Resources

### 免费 Live2D 模型下载站

- **Booth.pm** — https://booth.pm/ja/search/Live2D%20モデル%20無料 — 日本同人创作平台，搜"Live2D 無料"
- **nizima.com** — https://nizima.com — Live2D 官方模型市场，可筛选免费
- **Live2D 官方示例** — https://www.live2d.com/en/learn/sample/ — Haru、Hiyori 等官方模型
- **GitHub** — 搜 "live2d model" 或 "model3.json"

### 免费 MMD 模型下载站

- **Bowlroll** — https://bowlroll.net — 搜索"TDA初音"等，日本 MMD 资源主站
- **DeviantArt** — https://www.deviantart.com — 搜 "MMD model download"
- **ニコニ立体** — https://3d.nicovideo.jp — Niconico 旗下 3D 模型分享平台

## Done

- [x] Phase 1: asuka 后端 local_server.py (WebSocket)
- [x] Phase 2: Live2D web 渲染层 (pixi-live2d-display + Cubism4)
- [x] Phase 3: SwiftUI 桌面应用 (NSPanel + WKWebView + 聊天 UI)
- [x] Phase 4: 端到端联调 (本地 HTTP server 解决 WASM 加载)
