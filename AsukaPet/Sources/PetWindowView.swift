import SwiftUI
import WebKit

extension Notification.Name {
    static let petTapped = Notification.Name("petTapped")
    static let petProactive = Notification.Name("petProactive")
}

func debugLog(_ msg: String) {
    let line = "[AsukaPet] \(msg)\n"
    if let data = line.data(using: .utf8) {
        if let fh = FileHandle(forWritingAtPath: "/tmp/asuka_webview.log") {
            fh.seekToEndOfFile()
            fh.write(data)
            fh.closeFile()
        } else {
            FileManager.default.createFile(atPath: "/tmp/asuka_webview.log", contents: data)
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

                    if showInput {
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
                        .transition(.opacity)
                    }
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

            // 侧边面板
            if showPanel {
                ActionPanel(petState: petState)
                    .frame(width: 120)
                    .transition(.move(edge: .trailing))
            }
        }
        .frame(height: 500)
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
                TabButton(title: "状态", selected: selectedTab == 0) { selectedTab = 0 }
                TabButton(title: "表情", selected: selectedTab == 1) { selectedTab = 1 }
                TabButton(title: "动作", selected: selectedTab == 2) { selectedTab = 2 }
            }
            .padding(.horizontal, 4)
            .padding(.top, 4)

            ScrollView(.vertical, showsIndicators: false) {
                VStack(spacing: 3) {
                    if selectedTab == 0 {
                        StatusPanel(petState: petState)
                    } else if selectedTab == 1 {
                        ForEach(petState.expressions, id: \.self) { expr in
                            ActionButton(title: expr) {
                                petState.triggerAction?("setExpression('\(expr)')")
                            }
                        }
                    } else {
                        ForEach(Array(petState.motionGroups.keys.sorted()), id: \.self) { group in
                            let count = petState.motionGroups[group] ?? 0
                            let displayName = group.isEmpty ? "默认" : group
                            ForEach(0..<count, id: \.self) { idx in
                                ActionButton(title: count > 1 ? "\(displayName) \(idx+1)" : displayName) {
                                    petState.triggerAction?("playMotion('\(group)', \(idx))")
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

/// 状态面板：展示情绪和好感度
struct StatusPanel: View {
    @ObservedObject var petState: PetState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            StatRow(label: "心情", value: petState.moodDisplayName, icon: moodIcon)
            StatRow(label: "状态", value: petState.energyDisplayName, icon: "bolt")

            Divider().padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 10))
                        .foregroundColor(.pink)
                    Text("好感度")
                        .font(.system(size: 10, weight: .medium))
                    Spacer()
                    Text("\(petState.affection)/100")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
                ProgressView(value: Double(petState.affection), total: 100)
                    .tint(.pink)
                    .scaleEffect(y: 0.6)
                Text(petState.affectionLevel)
                    .font(.system(size: 10))
                    .foregroundColor(.pink)
            }

            Divider().padding(.vertical, 2)

            StatRow(label: "今日聊天", value: "\(petState.todayChats) 次", icon: "bubble.left")
            StatRow(label: "总聊天", value: "\(petState.totalChats) 次", icon: "chart.bar")
        }
        .padding(8)
    }

    var moodIcon: String {
        switch petState.currentMood {
        case "happy": return "face.smiling"
        case "excited": return "star.fill"
        case "irritated": return "flame"
        case "sad": return "cloud.rain"
        case "shy": return "heart"
        case "confused": return "questionmark.circle"
        case "surprised": return "exclamationmark.triangle"
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
            let url = server.baseURL.appendingPathComponent("index.html")
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
        // 先检查 bundle 内
        if let resourceURL = Bundle.main.resourceURL {
            let bundleWeb = resourceURL.appendingPathComponent("AsukaPet_AsukaPet.bundle/web", isDirectory: true)
            if FileManager.default.fileExists(atPath: bundleWeb.appendingPathComponent("index.html").path) {
                return bundleWeb
            }
        }
        // 从可执行文件位置向上找
        let execURL = Bundle.main.executableURL ?? Bundle.main.bundleURL
        var dir = execURL.deletingLastPathComponent()
        for _ in 0..<6 {
            let candidate = dir.appendingPathComponent("web", isDirectory: true)
            if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("index.html").path) {
                return candidate
            }
            dir = dir.deletingLastPathComponent()
        }
        // 硬编码开发路径作为最后兜底
        let devPath = URL(fileURLWithPath: NSString("~/work/asuka-desktop-swift/web").expandingTildeInPath)
        if FileManager.default.fileExists(atPath: devPath.appendingPathComponent("index.html").path) {
            return devPath
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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            debugLog("Page loaded: \(webView.url?.absoluteString ?? "nil")")
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                self?.isReady = true
                if let mood = self?.pendingMood, let energy = self?.pendingEnergy {
                    self?.updateEmotion(mood: mood, energy: energy)
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
                            self?.pendingMood = modelId
                            self?.isReady = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                self?.isReady = true
                                self?.webView?.evaluateJavaScript("switchMMDModel('\(modelId)')")
                            }
                        } else {
                            self?.webView?.evaluateJavaScript(js)
                        }
                    }
                }
            case "tap":
                NotificationCenter.default.post(name: .petTapped, object: nil)
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
