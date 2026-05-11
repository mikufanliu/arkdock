import SwiftUI
import WebKit

extension Notification.Name {
    static let petTapped = Notification.Name("petTapped")
    static let petProactive = Notification.Name("petProactive")
}

func debugLog(_ msg: String) {
    let line = "[ArkDock] \(msg)\n"
    if let data = line.data(using: .utf8) {
        if let fh = FileHandle(forWritingAtPath: "/tmp/arkdock.log") {
            fh.seekToEndOfFile()
            fh.write(data)
            fh.closeFile()
        } else {
            FileManager.default.createFile(atPath: "/tmp/arkdock.log", contents: data)
        }
    }
    fputs(line, stderr)
}

/// 主窗口：透明背景 + Live2D WKWebView + 聊天输入
struct PetWindowView: View {
    @EnvironmentObject var petState: PetState
    @State private var inputText = ""
    @State private var showInput = false
    @State private var showBubble = false
    @State private var showPanel = false
    @State private var bubbleTimer: Timer?
    @State private var lastMessageCount = 0

    var body: some View {
        HStack(spacing: 0) {
            ZStack {
                Live2DWebView(mood: petState.currentMood, energy: petState.currentEnergy)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                VStack(spacing: 0) {
                    if showBubble, let lastMsg = petState.messages.last, lastMsg.role == .assistant {
                        VStack(spacing: 2) {
                            Text(lastMsg.content)
                                .font(.system(size: 13))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
                                .frame(maxWidth: 300, alignment: .leading)
                                .lineLimit(8)

                            Triangle()
                                .fill(.ultraThinMaterial)
                                .frame(width: 12, height: 8)
                        }
                        .padding(.horizontal, 16)
                        .transition(.opacity)
                    }

                    Spacer()

                    SkillBar(petState: petState)
                }
                .allowsHitTesting(showBubble || !petState.skills.isEmpty)

                if showInput {
                    VStack {
                        Spacer()
                        HStack(spacing: 6) {
                            TextField("说点什么...", text: $inputText)
                                .textFieldStyle(.plain)
                                .padding(6)
                                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
                                .onSubmit {
                                    sendMessage()
                                }

                            if petState.isThinking {
                                ProgressView()
                                    .scaleEffect(0.6)
                            } else {
                                Button(action: sendMessage) {
                                    Image(systemName: "arrow.up.circle.fill")
                                        .font(.system(size: 18))
                                }
                                .buttonStyle(.plain)
                                .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 8)
                    }
                    .transition(.opacity)
                }

                // 右侧展开按钮
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button(action: {
                            withAnimation(.spring(duration: 0.3)) {
                                showPanel.toggle()
                            }
                        }) {
                            Image(systemName: showPanel ? "chevron.right" : "theatermasks")
                                .font(.system(size: 12))
                                .frame(width: 20, height: 20)
                                .background(.ultraThinMaterial, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .padding(.trailing, 4)
                    }
                    Spacer()
                }
            }
            .frame(width: 350)
            .clipped()

            // 侧边面板
            if showPanel {
                ActionPanel(petState: petState)
                    .frame(width: 120)
                    .transition(.move(edge: .trailing))
            }
        }
        .frame(width: showPanel ? 470 : 350, height: 500)
        .animation(.spring(duration: 0.3), value: showPanel)
        .background(.clear)
        .onReceive(NotificationCenter.default.publisher(for: .petTapped)) { _ in
            withAnimation(.spring(duration: 0.3)) {
                showInput.toggle()
                if showInput, let lastMsg = petState.messages.last, lastMsg.role == .assistant {
                    showBubbleTemporarily()
                }
            }
        }
        .onChange(of: petState.messages.count) { _, newCount in
            if newCount > lastMessageCount,
               let lastMsg = petState.messages.last, lastMsg.role == .assistant {
                showBubbleTemporarily()
            }
            lastMessageCount = newCount
        }
        .onReceive(NotificationCenter.default.publisher(for: .petProactive)) { _ in
            showBubbleTemporarily()
        }
    }

    private func showBubbleTemporarily() {
        bubbleTimer?.invalidate()
        withAnimation(.easeIn(duration: 0.2)) {
            showBubble = true
        }
        bubbleTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { _ in
            DispatchQueue.main.async {
                withAnimation(.easeOut(duration: 0.5)) {
                    showBubble = false
                }
            }
        }
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        petState.send(text)
        inputText = ""
    }
}

/// 侧边动作面板：自动读取模型可用的表情和动作
struct ActionPanel: View {
    @ObservedObject var petState: PetState
    @State private var selectedTab = 0

    var body: some View {
        VStack(spacing: 4) {
            HStack(spacing: 1) {
                TabButton(title: "档案", selected: selectedTab == 0) { selectedTab = 0 }
                TabButton(title: "动作", selected: selectedTab == 2) { selectedTab = 2 }
                TabButton(title: "语音", selected: selectedTab == 3) { selectedTab = 3 }
            }
            .padding(.horizontal, 4)
            .padding(.top, 4)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 3) {
                    if selectedTab == 0 {
                        ArchivePanel(petState: petState)
                    } else if selectedTab == 1 {
                        ForEach(petState.expressions, id: \.self) { expr in
                            ActionButton(title: expr) {
                                petState.triggerAction?("setExpression('\(expr)')")
                            }
                        }
                    } else if selectedTab == 2 {
                        ForEach(Array(petState.motionGroups.keys.sorted()), id: \.self) { group in
                            let count = petState.motionGroups[group] ?? 0
                            let displayName = group.isEmpty ? "默认" : group
                            ForEach(0..<count, id: \.self) { idx in
                                ActionButton(title: count > 1 ? "\(displayName) \(idx+1)" : displayName) {
                                    petState.triggerAction?("playMotion('\(group)', \(idx))")
                                }
                            }
                        }
                    } else if selectedTab == 3 {
                        VoiceLinesPanel(petState: petState)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

private func findIconPath(_ filename: String) -> String? {
    if let resourceURL = Bundle.main.resourceURL {
        let bundlePath = resourceURL.appendingPathComponent("ArkDock_ArkDock.bundle/web/model/icons/\(filename)").path
        if FileManager.default.fileExists(atPath: bundlePath) { return bundlePath }
    }
    let execURL = Bundle.main.executableURL ?? Bundle.main.bundleURL
    var dir = execURL.deletingLastPathComponent()
    for _ in 0..<6 {
        let candidate = dir.appendingPathComponent("web/model/icons/\(filename)").path
        if FileManager.default.fileExists(atPath: candidate) { return candidate }
        dir = dir.deletingLastPathComponent()
    }
    return nil
}

private func professionIcon(_ name: String) -> some View {
    let image: NSImage? = {
        guard let path = findIconPath("prof_\(name).png") else { return nil }
        return NSImage(contentsOfFile: path)
    }()
    return Group {
        if let img = image {
            Image(nsImage: img)
                .resizable()
                .interpolation(.high)
        } else {
            Image(systemName: "shield.fill")
                .resizable()
        }
    }
}

private func subProfessionIcon(_ name: String) -> some View {
    let image: NSImage? = {
        guard let path = findIconPath("sub_\(name).png") else { return nil }
        return NSImage(contentsOfFile: path)
    }()
    return Group {
        if let img = image {
            Image(nsImage: img)
                .resizable()
                .interpolation(.high)
        } else {
            Image(systemName: "arrow.triangle.branch")
                .resizable()
        }
    }
}

/// 状态面板：展示情绪和好感度
struct ArchivePanel: View {
    @ObservedObject var petState: PetState
    @State private var archiveIndex = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header: name + profession
            HStack(spacing: 6) {
                if let prof = petState.persona?.profession, !prof.isEmpty {
                    professionIcon(prof)
                        .frame(width: 20, height: 20)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(petState.persona?.name ?? petState.currentCharId.uppercased())
                        .font(.system(size: 12, weight: .bold))
                    if let prof = petState.persona?.profession, !prof.isEmpty {
                        HStack(spacing: 3) {
                            if let sub = petState.persona?.subProfession, !sub.isEmpty {
                                subProfessionIcon(sub)
                                    .frame(width: 14, height: 14)
                                Text(sub)
                                    .font(.system(size: 9))
                                    .foregroundColor(.secondary)
                            }
                            Text(prof)
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                        }
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)

            // Trust bar
            HStack(spacing: 4) {
                Image(systemName: "heart.fill")
                    .font(.system(size: 9))
                    .foregroundColor(.pink)
                Text("信赖")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                ProgressView(value: Double(petState.affection), total: 100)
                    .tint(.accentColor)
                    .scaleEffect(y: 0.5)
                Text("\(petState.affection)%")
                    .font(.system(size: 9))
                    .foregroundColor(.accentColor)
            }
            .padding(.horizontal, 6)

            // Archive selector
            if let archives = petState.persona?.archives, !archives.isEmpty {
                HStack(spacing: 2) {
                    ForEach(0..<min(archives.count, 6), id: \.self) { i in
                        Button(action: { archiveIndex = i }) {
                            Text("\(i + 1)")
                                .font(.system(size: 9, weight: archiveIndex == i ? .bold : .regular))
                                .frame(width: 16, height: 16)
                                .background(
                                    archiveIndex == i ? Color.accentColor.opacity(0.3) : Color.clear,
                                    in: RoundedRectangle(cornerRadius: 3)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    Text(archives[archiveIndex].title)
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 6)

                // Archive content
                ScrollView(.vertical, showsIndicators: true) {
                    Text(archives[archiveIndex].content)
                        .font(.system(size: 9))
                        .lineSpacing(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                }
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 5))
                .padding(.horizontal, 4)
            } else {
                Text("无档案数据")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .padding(8)
            }
        }
        .padding(4)
    }
}

struct StatusPanel: View {
    @ObservedObject var petState: PetState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StatRow(label: "心情", value: petState.moodDisplayName, icon: moodIcon)
            StatRow(label: "状态", value: petState.energyDisplayName, icon: "bolt")
            StatRow(label: "今日聊天", value: "\(petState.todayChats) 次", icon: "bubble.left")
        }
        .padding(8)
    }

    var moodIcon: String {
        switch petState.currentMood {
        case "happy": return "face.smiling"
        case "excited": return "star.fill"
        case "irritated": return "flame"
        case "sad": return "cloud.rain"
        default: return "face.smiling"
        }
    }
}

struct StatRow: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
                .frame(width: 14)
            Text(label)
                .font(.system(size: 10))
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 10, weight: .medium))
        }
    }
}

struct TabButton: View {
    let title: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: selected ? .semibold : .regular))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
                .background(selected ? Color.accentColor.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
    }
}

struct ActionButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 5))
        }
        .buttonStyle(.plain)
    }
}

/// 语音面板：列出语音台词
struct VoiceLinesPanel: View {
    @ObservedObject var petState: PetState

    var body: some View {
        if petState.voiceLines.isEmpty {
            Text("暂无语音数据")
                .font(.system(size: 11))
                .foregroundColor(.secondary)
                .padding(8)
        } else {
            ForEach(petState.voiceLines) { line in
                ActionButton(title: line.title) {
                    playVoiceLine(line)
                }
            }
        }
    }

    private func playVoiceLine(_ line: VoiceLine) {
        petState.messages.append(ChatMessage(role: .assistant, content: line.content))
        petState.playVoiceAudio(line.audioFile)

        let key = line.key.lowercased()
        if key.contains("poke") || key.contains("touch") || key.contains("pat") {
            let shortMotions = petState.motionGroups.keys.filter {
                $0.lowercased().contains("touch") || $0.lowercased().contains("interact") || $0.lowercased().contains("special")
            }
            if let motion = shortMotions.randomElement() {
                petState.triggerAction?("playMotion('\(motion)', 0)")
            } else {
                playIdleVariant()
            }
        } else {
            // idle 类 → 播 Idle 变体
            playIdleVariant()
        }
    }

    private func playIdleVariant() {
        let idleMotions = petState.motionGroups.filter {
            $0.key.lowercased().contains("idle")
        }
        if let (group, count) = idleMotions.randomElement(), count > 0 {
            let idx = Int.random(in: 0..<count)
            petState.triggerAction?("playMotion('\(group)', \(idx))")
        }
    }
}

/// 技能栏：显示技能按钮
struct SkillBar: View {
    @ObservedObject var petState: PetState

    private var isBuildMode: Bool {
        petState.currentModel.contains("build")
    }

    var body: some View {
        if !petState.skills.isEmpty && !isBuildMode {
            HStack(spacing: 8) {
                ForEach(petState.skills) { skill in
                    Button(action: { activateSkill(skill) }) {
                        VStack(spacing: 1) {
                            skillIcon(skill.icon)
                                .frame(width: 28, height: 28)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                            Text(skill.name)
                                .font(.system(size: 8, design: .monospaced))
                                .foregroundColor(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }
                    .buttonStyle(.plain)
                    .help(skill.description)
                }
            }
            .padding(.vertical, 2)
            .padding(.horizontal, 8)
        }
    }

    @ViewBuilder
    private func skillIcon(_ icon: String) -> some View {
        if icon.contains(".png") || icon.contains("/"), let img = loadSkillImage(icon) {
            Image(nsImage: img)
                .resizable()
                .aspectRatio(contentMode: .fit)
        } else {
            Image(systemName: icon.isEmpty ? "star.fill" : icon)
                .font(.system(size: 16, weight: .bold))
                .frame(width: 36, height: 36)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 6))
        }
    }

    private func loadSkillImage(_ relativePath: String) -> NSImage? {
        guard let webDir = PetState.shared.findWebDirectory() else { return nil }
        let charId = PetState.shared.currentCharId
        let fullPath = webDir.appendingPathComponent("model/\(charId)/\(relativePath)")
        return NSImage(contentsOf: fullPath)
    }

    private func activateSkill(_ skill: SkillInfo) {
        petState.triggerAction?("playMotion('\(skill.animation)', 0)")
        if !skill.voiceLine.isEmpty {
            petState.messages.append(ChatMessage(role: .assistant, content: skill.voiceLine))
        }
        petState.playVoiceAudio(skill.audioFile)
    }
}

/// 三角形尖角（气泡指向角色）
struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

/// WKWebView 封装：加载 Live2D HTML 并通过 JS Bridge 控制表情
struct Live2DWebView: NSViewRepresentable {
    let mood: String
    let energy: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "petEvent")
        contentController.add(context.coordinator, name: "consoleLog")

        let consoleScript = WKUserScript(source: """
            (function() {
                var orig = console.log; var origErr = console.error;
                console.log = function() {
                    orig.apply(console, arguments);
                    window.webkit.messageHandlers.consoleLog.postMessage({level:'log', msg: Array.from(arguments).join(' ')});
                };
                console.error = function() {
                    origErr.apply(console, arguments);
                    window.webkit.messageHandlers.consoleLog.postMessage({level:'error', msg: Array.from(arguments).join(' ')});
                };
                window.onerror = function(msg, url, line) {
                    window.webkit.messageHandlers.consoleLog.postMessage({level:'error', msg: msg + ' at ' + url + ':' + line});
                };
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(consoleScript)

        config.userContentController = contentController
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator

        // 启动本地 HTTP server 并通过 http:// 加载（解决 WASM file:// 限制）
        let webDir = findWebDirectory()
        if let dir = webDir {
            let server = LocalHTTPServer.shared
            server.start(servingDirectory: dir)
            let page: String
            switch PetState.shared.modelTypeFor(PetState.shared.currentModel) {
            case .spine: page = "spine.html"
            case .mmd: page = "mmd.html"
            case .live2d: page = "index.html"
            }
            let url = server.baseURL.appendingPathComponent(page)
            debugLog("Loading via HTTP: \(url)")
            webView.load(URLRequest(url: url))
        } else {
            debugLog("ERROR: web/ directory not found!")
            webView.loadHTMLString("<h1>web/ 目录未找到</h1>", baseURL: nil)
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.updateEmotion(mood: mood, energy: energy)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    /// 查找 web 目录（bundle 或开发路径）
    private func findWebDirectory() -> URL? {
        if let resourceURL = Bundle.main.resourceURL {
            let bundleWeb = resourceURL.appendingPathComponent("ArkDock_ArkDock.bundle/web", isDirectory: true)
            if FileManager.default.fileExists(atPath: bundleWeb.appendingPathComponent("index.html").path) {
                return bundleWeb
            }
        }
        let execURL = Bundle.main.executableURL ?? Bundle.main.bundleURL
        var dir = execURL.deletingLastPathComponent()
        for _ in 0..<6 {
            let candidate = dir.appendingPathComponent("web", isDirectory: true)
            if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("index.html").path) {
                return candidate
            }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private var isReady = false
        private var pendingMood: String?
        private var pendingEnergy: String?

        func updateEmotion(mood: String, energy: String) {
            guard isReady else {
                pendingMood = mood
                pendingEnergy = energy
                return
            }
            let js = "if(typeof setEmotion==='function') setEmotion('\(mood)', '\(energy)')"
            webView?.evaluateJavaScript(js)
        }

        func triggerExpression(_ name: String) {
            let js = "if(typeof setExpression==='function') setExpression('\(name)')"
            webView?.evaluateJavaScript(js)
        }

        func triggerMotion(_ group: String, index: Int) {
            let js = "if(typeof playMotion==='function') playMotion('\(group)', \(index))"
            webView?.evaluateJavaScript(js)
        }

        @MainActor
        func showContextMenu(at point: NSPoint) {
            guard let webView = webView, let window = webView.window else { return }

            let menu = NSMenu()

            // 切换模型子菜单（层级）
            let modelMenu = NSMenu()
            for char in PetState.shared.characters {
                if char.isSingleMode {
                    let modelId = char.skins[0].modes[0].path == "." ? char.id : "\(char.id)/\(char.skins[0].modes[0].path)"
                    let item = NSMenuItem(title: char.name, action: #selector(contextMenuSwitchModel(_:)), keyEquivalent: "")
                    item.target = self
                    item.representedObject = modelId
                    if PetState.shared.currentModel == modelId || PetState.shared.currentModel.hasPrefix(char.id) {
                        item.state = .on
                    }
                    modelMenu.addItem(item)
                } else if char.skins.count == 1 {
                    let charItem = NSMenuItem(title: char.name, action: nil, keyEquivalent: "")
                    let subMenu = NSMenu()
                    for mode in char.skins[0].modes {
                        let modelId = "\(char.id)/\(mode.path)"
                        let modeItem = NSMenuItem(title: mode.name, action: #selector(contextMenuSwitchModel(_:)), keyEquivalent: "")
                        modeItem.target = self
                        modeItem.representedObject = modelId
                        if PetState.shared.currentModel == modelId { modeItem.state = .on }
                        subMenu.addItem(modeItem)
                    }
                    charItem.submenu = subMenu
                    modelMenu.addItem(charItem)
                } else {
                    let charItem = NSMenuItem(title: char.name, action: nil, keyEquivalent: "")
                    let charMenu = NSMenu()
                    for skin in char.skins {
                        let skinItem = NSMenuItem(title: skin.name, action: nil, keyEquivalent: "")
                        let skinMenu = NSMenu()
                        for mode in skin.modes {
                            let modelId = "\(char.id)/\(mode.path)"
                            let modeItem = NSMenuItem(title: mode.name, action: #selector(contextMenuSwitchModel(_:)), keyEquivalent: "")
                            modeItem.target = self
                            modeItem.representedObject = modelId
                            if PetState.shared.currentModel == modelId { modeItem.state = .on }
                            skinMenu.addItem(modeItem)
                        }
                        skinItem.submenu = skinMenu
                        charMenu.addItem(skinItem)
                    }
                    charItem.submenu = charMenu
                    modelMenu.addItem(charItem)
                }
            }
            let modelItem = NSMenuItem(title: "切换模型", action: nil, keyEquivalent: "")
            modelItem.submenu = modelMenu
            menu.addItem(modelItem)

            // 动作子菜单
            let motionMenu = NSMenu()
            for (name, _) in PetState.shared.motionGroups.sorted(by: { $0.key < $1.key }) {
                let item = NSMenuItem(title: name, action: #selector(contextMenuPlayMotion(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = name
                motionMenu.addItem(item)
            }
            let motionItem = NSMenuItem(title: "动作", action: nil, keyEquivalent: "")
            motionItem.submenu = motionMenu
            menu.addItem(motionItem)

            menu.addItem(.separator())

            // 翻转
            let flipItem = NSMenuItem(title: "翻转方向", action: #selector(contextMenuFlip), keyEquivalent: "")
            flipItem.target = self
            menu.addItem(flipItem)

            // 缩放子菜单
            let scaleMenu = NSMenu()
            for scale in [0.5, 0.75, 1.0, 1.25, 1.5] {
                let item = NSMenuItem(title: "\(Int(scale * 100))%", action: #selector(contextMenuSetScale(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = scale
                if abs(PetState.shared.globalScale - scale) < 0.01 { item.state = .on }
                scaleMenu.addItem(item)
            }
            let scaleItem = NSMenuItem(title: "缩放", action: nil, keyEquivalent: "")
            scaleItem.submenu = scaleMenu
            menu.addItem(scaleItem)

            // AI 设置子菜单
            let aiMenu = NSMenu()
            let providerItem = NSMenuItem(title: PetState.shared.llmConfig.isConfigured ? "AI 已启用 (\(PetState.shared.llmConfig.model))" : "未配置 API Key", action: nil, keyEquivalent: "")
            providerItem.isEnabled = false
            aiMenu.addItem(providerItem)
            aiMenu.addItem(.separator())
            let configItem = NSMenuItem(title: "配置 AI...", action: #selector(contextMenuConfigAI), keyEquivalent: "")
            configItem.target = self
            aiMenu.addItem(configItem)
            let aiMenuItem = NSMenuItem(title: "AI 设置", action: nil, keyEquivalent: "")
            aiMenuItem.submenu = aiMenu
            menu.addItem(aiMenuItem)

            menu.addItem(.separator())

            // 清空对话
            let clearItem = NSMenuItem(title: "清空对话", action: #selector(contextMenuClear), keyEquivalent: "")
            clearItem.target = self
            menu.addItem(clearItem)

            // 退出
            let quitItem = NSMenuItem(title: "退出", action: #selector(contextMenuQuit), keyEquivalent: "q")
            quitItem.target = self
            menu.addItem(quitItem)

            // 计算屏幕坐标弹出菜单
            let viewPoint = NSPoint(x: point.x, y: webView.bounds.height - point.y)
            let windowPoint = webView.convert(viewPoint, to: nil)
            let screenPoint = window.convertPoint(toScreen: windowPoint)
            menu.popUp(positioning: nil, at: screenPoint, in: nil)
        }

        @objc func contextMenuSwitchModel(_ sender: NSMenuItem) {
            guard let modelId = sender.representedObject as? String else { return }
            Task { @MainActor in
                PetState.shared.switchModel(modelId)
            }
        }

        @objc func contextMenuPlayMotion(_ sender: NSMenuItem) {
            guard let name = sender.representedObject as? String else { return }
            let js = "if(typeof playMotion==='function') playMotion('\(name)', 0)"
            webView?.evaluateJavaScript(js)
        }

        @objc func contextMenuFlip() {
            let js = "if(typeof flipModel==='function') flipModel()"
            webView?.evaluateJavaScript(js)
        }

        @objc func contextMenuSetScale(_ sender: NSMenuItem) {
            guard let scale = sender.representedObject as? Double else { return }
            Task { @MainActor in
                PetState.shared.setGlobalScale(scale)
            }
        }

        @objc func contextMenuConfigAI() {
            Task { @MainActor in
                showAIConfigAlert()
            }
        }

        @MainActor
        func showAIConfigAlert() {
            let alert = NSAlert()
            alert.messageText = "AI 配置"
            alert.informativeText = "配置 LLM Provider"
            alert.alertStyle = .informational

            let view = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 160))

            let providerLabel = NSTextField(labelWithString: "Provider:")
            providerLabel.frame = NSRect(x: 0, y: 130, width: 70, height: 20)
            view.addSubview(providerLabel)

            let providerPopup = NSPopUpButton(frame: NSRect(x: 75, y: 128, width: 220, height: 24))
            providerPopup.addItems(withTitles: ["Anthropic (Claude)", "OpenAI Compatible"])
            if PetState.shared.llmConfig.provider == .openAICompatible { providerPopup.selectItem(at: 1) }
            view.addSubview(providerPopup)

            let endpointLabel = NSTextField(labelWithString: "Endpoint:")
            endpointLabel.frame = NSRect(x: 0, y: 98, width: 70, height: 20)
            view.addSubview(endpointLabel)

            let endpointField = NSTextField(frame: NSRect(x: 75, y: 96, width: 220, height: 24))
            endpointField.stringValue = PetState.shared.llmConfig.endpoint
            endpointField.placeholderString = "https://api.anthropic.com"
            view.addSubview(endpointField)

            let keyLabel = NSTextField(labelWithString: "API Key:")
            keyLabel.frame = NSRect(x: 0, y: 66, width: 70, height: 20)
            view.addSubview(keyLabel)

            let keyField = NSSecureTextField(frame: NSRect(x: 75, y: 64, width: 220, height: 24))
            keyField.stringValue = PetState.shared.llmConfig.apiKey
            keyField.placeholderString = "sk-..."
            view.addSubview(keyField)

            let modelLabel = NSTextField(labelWithString: "Model:")
            modelLabel.frame = NSRect(x: 0, y: 34, width: 70, height: 20)
            view.addSubview(modelLabel)

            let modelField = NSTextField(frame: NSRect(x: 75, y: 32, width: 220, height: 24))
            modelField.stringValue = PetState.shared.llmConfig.model
            modelField.placeholderString = "claude-sonnet-4-20250514"
            view.addSubview(modelField)

            alert.accessoryView = view
            alert.addButton(withTitle: "保存")
            alert.addButton(withTitle: "取消")

            let result = alert.runModal()
            if result == .alertFirstButtonReturn {
                let provider: ProviderType = providerPopup.indexOfSelectedItem == 0 ? .anthropic : .openAICompatible
                let config = LLMConfig(
                    provider: provider,
                    endpoint: endpointField.stringValue.isEmpty ? (provider == .anthropic ? "https://api.anthropic.com" : "https://api.openai.com") : endpointField.stringValue,
                    apiKey: keyField.stringValue,
                    model: modelField.stringValue.isEmpty ? (provider == .anthropic ? "claude-sonnet-4-20250514" : "gpt-4o-mini") : modelField.stringValue
                )
                PetState.shared.updateLLMConfig(config)
            }
        }

        @objc func contextMenuClear() {
            Task { @MainActor in
                PetState.shared.clearConversation()
            }
        }

        @objc func contextMenuQuit() {
            NSApplication.shared.terminate(nil)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            debugLog("Page loaded: \(webView.url?.absoluteString ?? "nil")")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.isReady = true
                if let mood = self?.pendingMood, let energy = self?.pendingEnergy {
                    self?.updateEmotion(mood: mood, energy: energy)
                }
                // Auto-load current model after page is ready
                Task { @MainActor in
                    let modelId = PetState.shared.currentModel
                    switch PetState.shared.modelTypeFor(modelId) {
                    case .spine:
                        webView.evaluateJavaScript("switchSpineModel('\(modelId)')")
                    case .mmd:
                        webView.evaluateJavaScript("switchMMDModel('\(modelId)')")
                    case .live2d:
                        webView.evaluateJavaScript("switchModel('\(modelId)')")
                    }
                }
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            debugLog("Navigation failed: \(error)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            debugLog("Provisional navigation failed: \(error)")
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "consoleLog" {
                if let body = message.body as? [String: Any] {
                    let level = body["level"] as? String ?? "log"
                    let msg = body["msg"] as? String ?? ""
                    debugLog("JS \(level): \(msg)")
                }
                return
            }
            guard let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String ?? ""

            switch type {
            case "ready":
                isReady = true
                if let mood = pendingMood, let energy = pendingEnergy {
                    updateEmotion(mood: mood, energy: energy)
                }
                if let exprs = body["expressions"] as? [String] {
                    Task { @MainActor in
                        PetState.shared.expressions = exprs
                    }
                }
                if let motions = body["motionGroups"] as? [String: Int] {
                    Task { @MainActor in
                        PetState.shared.motionGroups = motions
                    }
                }
                Task { @MainActor in
                    PetState.shared.triggerAction = { [weak self] js in
                        if js.hasPrefix("__RELOAD_MMD__:") {
                            let modelId = String(js.dropFirst("__RELOAD_MMD__:".count))
                            let mmdURL = LocalHTTPServer.shared.baseURL.appendingPathComponent("mmd.html")
                            self?.webView?.load(URLRequest(url: mmdURL))
                            self?.isReady = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                self?.isReady = true
                                self?.webView?.evaluateJavaScript("switchMMDModel('\(modelId)')")
                            }
                        } else if js.hasPrefix("__RELOAD_SPINE__:") {
                            let modelId = String(js.dropFirst("__RELOAD_SPINE__:".count))
                            let spineURL = LocalHTTPServer.shared.baseURL.appendingPathComponent("spine.html")
                            self?.webView?.load(URLRequest(url: spineURL))
                            self?.isReady = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                self?.isReady = true
                                let scale = PetState.shared.globalScale
                                self?.webView?.evaluateJavaScript("setUserScale(\(scale))")
                                self?.webView?.evaluateJavaScript("switchSpineModel('\(modelId)')")
                            }
                        } else if js.hasPrefix("__RELOAD_LIVE2D__:") {
                            let modelId = String(js.dropFirst("__RELOAD_LIVE2D__:".count))
                            let live2dURL = LocalHTTPServer.shared.baseURL.appendingPathComponent("index.html")
                            self?.webView?.load(URLRequest(url: live2dURL))
                            self?.isReady = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                self?.isReady = true
                                self?.webView?.evaluateJavaScript("switchModel('\(modelId)')")
                            }
                        } else {
                            self?.webView?.evaluateJavaScript(js)
                        }
                    }
                }
            case "tap":
                NotificationCenter.default.post(name: .petTapped, object: nil)
            case "contextmenu":
                let x = body["x"] as? CGFloat ?? 0
                let y = body["y"] as? CGFloat ?? 0
                Task { @MainActor in
                    self.showContextMenu(at: NSPoint(x: x, y: y))
                }
            case "drag":
                if let window = webView?.window, let event = NSApp.currentEvent {
                    window.performDrag(with: event)
                }
            case "proactive":
                let content = body["content"] as? String ?? ""
                if !content.isEmpty {
                    Task { @MainActor in
                        PetState.shared.messages.append(ChatMessage(role: .assistant, content: content))
                    }
                    NotificationCenter.default.post(name: .petProactive, object: nil)
                }
            case "hit":
                debugLog("Hit: \(body)")
            default:
                break
            }
        }
    }
}
