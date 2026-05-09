import SwiftUI
import Combine

/// 全局状态：连接状态、情绪、对话历史
@MainActor
class PetState: ObservableObject {
    static let shared = PetState()

    @Published var isVisible: Bool = true
    @Published var isConnected: Bool = false
    @Published var clickThrough: Bool = false
    @Published var currentMood: String = "normal"
    @Published var currentEnergy: String = "calm"
    @Published var messages: [ChatMessage] = []
    @Published var isThinking: Bool = false
    @Published var expressions: [String] = []
    @Published var motionGroups: [String: Int] = [:]
    @Published var availableModels: [ModelInfo] = []
    @Published var currentModel: String = "icegirl"
    @Published var affection: Int = 0
    @Published var totalChats: Int = 0
    @Published var todayChats: Int = 0
    @Published var lastChatDate: String = ""

    var triggerAction: ((String) -> Void)?

    private var wsClient: WebSocketClient?

    init() {
        wsClient = WebSocketClient(
            url: URL(string: "ws://127.0.0.1:8765")!,
            onMessage: { [weak self] msg in
                Task { @MainActor in
                    self?.handleMessage(msg)
                }
            },
            onConnect: { [weak self] in
                Task { @MainActor in self?.isConnected = true }
            },
            onDisconnect: { [weak self] in
                Task { @MainActor in self?.isConnected = false }
            }
        )
        wsClient?.connect()
        scanModels()
    }

    func scanModels() {
        availableModels = []
        guard let webDir = findWebDirectory() else { return }
        let modelDir = webDir.appendingPathComponent("model")
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: modelDir.path) else { return }
        for entry in entries.sorted() {
            let subDir = modelDir.appendingPathComponent(entry)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: subDir.path, isDirectory: &isDir), isDir.boolValue else { continue }
            let files = (try? FileManager.default.contentsOfDirectory(atPath: subDir.path)) ?? []
            if files.contains(where: { $0.hasSuffix(".model3.json") }) {
                availableModels.append(ModelInfo(id: entry, name: entry.capitalized, path: "model/\(entry)", type: .live2d))
            } else if files.contains(where: { $0.hasSuffix(".pmx") || $0.hasSuffix(".pmd") }) {
                availableModels.append(ModelInfo(id: entry, name: entry.capitalized, path: "model/\(entry)", type: .mmd))
            }
        }
    }

    func switchModel(_ modelId: String) {
        guard modelId != currentModel else { return }
        let modelInfo = availableModels.first { $0.id == modelId }
        currentModel = modelId
        expressions = []
        motionGroups = [:]
        if modelInfo?.type == .mmd {
            triggerAction?("__RELOAD_MMD__:\(modelId)")
        } else {
            triggerAction?("switchModel('\(modelId)')")
        }
    }

    private func findWebDirectory() -> URL? {
        if let resourceURL = Bundle.main.resourceURL {
            let bundleWeb = resourceURL.appendingPathComponent("AsukaPet_AsukaPet.bundle/web", isDirectory: true)
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
        let devPath = URL(fileURLWithPath: NSString("~/work/asuka-desktop-swift/web").expandingTildeInPath)
        if FileManager.default.fileExists(atPath: devPath.appendingPathComponent("index.html").path) {
            return devPath
        }
        return nil
    }

    func send(_ text: String) {
        let msg = ChatMessage(role: .user, content: text)
        messages.append(msg)
        isThinking = true

        // 好感度系统
        affection = min(affection + 2, 100)
        totalChats += 1
        let today = Self.todayString()
        if lastChatDate != today {
            lastChatDate = today
            todayChats = 1
        } else {
            todayChats += 1
        }

        let payload: [String: Any] = ["type": "chat", "content": text]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let str = String(data: data, encoding: .utf8) {
            wsClient?.send(str)
        }
    }

    private static func todayString() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: Date())
    }

    var moodDisplayName: String {
        switch currentMood {
        case "happy": return "开心"
        case "excited": return "兴奋"
        case "normal": return "平静"
        case "irritated": return "烦躁"
        case "sad": return "难过"
        case "shy": return "害羞"
        case "confused": return "困惑"
        case "surprised": return "惊讶"
        default: return currentMood
        }
    }

    var energyDisplayName: String {
        switch currentEnergy {
        case "calm": return "平静"
        case "excited": return "活跃"
        case "tired": return "疲惫"
        default: return currentEnergy
        }
    }

    var affectionLevel: String {
        switch affection {
        case 0..<20: return "陌生"
        case 20..<40: return "认识"
        case 40..<60: return "熟悉"
        case 60..<80: return "亲密"
        case 80...100: return "挚友"
        default: return "???"
        }
    }

    func clearConversation() {
        messages.removeAll()
        let payload: [String: Any] = ["type": "clear"]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let str = String(data: data, encoding: .utf8) {
            wsClient?.send(str)
        }
    }

    private func handleMessage(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let type = json["type"] as? String ?? ""

        switch type {
        case "emotion":
            if let emotion = json["emotion"] as? [String: Any] {
                currentMood = emotion["mood"] as? String ?? "normal"
                currentEnergy = emotion["energy"] as? String ?? "calm"
            }

        case "delta":
            let content = json["content"] as? String ?? ""
            if let lastIdx = messages.indices.last, messages[lastIdx].role == .assistant {
                messages[lastIdx].content = content
            } else {
                messages.append(ChatMessage(role: .assistant, content: content))
            }

        case "reply":
            let content = json["content"] as? String ?? ""
            if let lastIdx = messages.indices.last, messages[lastIdx].role == .assistant {
                messages[lastIdx].content = content
            } else {
                messages.append(ChatMessage(role: .assistant, content: content))
            }
            isThinking = false
            if let emotion = json["emotion"] as? [String: Any] {
                currentMood = emotion["mood"] as? String ?? "normal"
                currentEnergy = emotion["energy"] as? String ?? "calm"
            }

        case "error":
            let content = json["content"] as? String ?? "未知错误"
            messages.append(ChatMessage(role: .system, content: "错误: \(content)"))
            isThinking = false

        case "tool":
            break

        case "system":
            let content = json["content"] as? String ?? ""
            messages.append(ChatMessage(role: .system, content: content))

        default:
            break
        }
    }
}

struct ChatMessage: Identifiable {
    let id = UUID()
    let role: Role
    var content: String

    enum Role {
        case user, assistant, system
    }
}

struct ModelInfo: Identifiable {
    let id: String
    let name: String
    let path: String
    let type: ModelType

    enum ModelType {
        case live2d, mmd
    }
}
