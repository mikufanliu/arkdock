import SwiftUI
import Combine
import AVFoundation

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
    @Published var characters: [CharacterInfo] = []
    @Published var currentModel: String = UserDefaults.standard.string(forKey: "currentModel") ?? "kaltsit/front"
    @Published var affection: Int = 0
    @Published var totalChats: Int = 0
    @Published var todayChats: Int = 0
    @Published var lastChatDate: String = ""
    @Published var voiceLines: [VoiceLine] = []
    @Published var skills: [SkillInfo] = []
    @Published var globalScale: Double = {
        let v = UserDefaults.standard.double(forKey: "globalScale")
        return v > 0 ? v : 1.0
    }()
    @Published var llmConfig: LLMConfig = LLMConfig.load() ?? .defaultAnthropic
    @Published var persona: Persona?

    var triggerAction: ((String) -> Void)?
    private var audioPlayer: AVAudioPlayer?
    private var chatEngine: ChatEngine?
    private var chatTask: Task<Void, Never>?
    private var idleTimer: Timer?

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
        loadVoiceLines()
        loadSkills()
        loadPersona()
        loadChatHistory()
        startIdleTimer()
    }

    // MARK: - Idle Chatter

    private func startIdleTimer() {
        idleTimer?.invalidate()
        let interval = Double.random(in: 45...120)
        idleTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.idleSpeak()
                self?.startIdleTimer()
            }
        }
    }

    private func idleSpeak() {
        guard let persona = persona else { return }
        var pool: [String] = persona.idleLines
        if let talks = persona.talkLines { pool.append(contentsOf: talks) }
        guard let line = pool.randomElement(), !line.isEmpty else { return }

        messages.append(ChatMessage(role: .assistant, content: line))
        saveChatHistory()
        NotificationCenter.default.post(name: .petProactive, object: nil)
    }

    // MARK: - Chat History Persistence

    private var historyDirectory: URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("ArkDock/history", isDirectory: true)
    }

    private func historyPath(for charId: String) -> URL {
        historyDirectory.appendingPathComponent("\(charId).json")
    }

    func saveChatHistory() {
        let saveable = messages.filter { $0.role != .system }.suffix(50)
        guard !saveable.isEmpty else { return }
        do {
            try FileManager.default.createDirectory(at: historyDirectory, withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(Array(saveable))
            try data.write(to: historyPath(for: currentCharId))
        } catch {
            debugLog("保存聊天记录失败: \(error)")
        }
    }

    func loadChatHistory() {
        let path = historyPath(for: currentCharId)
        guard FileManager.default.fileExists(atPath: path.path),
              let data = try? Data(contentsOf: path),
              let history = try? JSONDecoder().decode([ChatMessage].self, from: data) else {
            return
        }
        messages = history
    }

    func loadPersona() {
        guard let webDir = findWebDirectory() else { return }
        let charId = currentCharId
        let personaPath = webDir.appendingPathComponent("model/\(charId)/persona.json")
        guard FileManager.default.fileExists(atPath: personaPath.path),
              let data = try? Data(contentsOf: personaPath),
              let p = try? JSONDecoder().decode(Persona.self, from: data) else {
            persona = nil
            chatEngine = nil
            return
        }
        persona = p
        rebuildChatEngine()
    }

    func rebuildChatEngine() {
        guard let persona = persona else {
            chatEngine = nil
            return
        }
        if llmConfig.isConfigured {
            let provider = LLMProvider(config: llmConfig)
            chatEngine = LLMChatEngine(persona: persona, provider: provider)
        } else {
            chatEngine = ScriptedChatEngine(persona: persona)
        }
    }

    func updateLLMConfig(_ config: LLMConfig) {
        llmConfig = config
        config.save()
        rebuildChatEngine()
    }

    func scanModels() {
        characters = []
        guard let webDir = findWebDirectory() else { return }
        let modelDir = webDir.appendingPathComponent("model")
        guard let entries = try? FileManager.default.contentsOfDirectory(atPath: modelDir.path) else { return }
        for entry in entries.sorted() {
            let charDir = modelDir.appendingPathComponent(entry)
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: charDir.path, isDirectory: &isDir), isDir.boolValue else { continue }

            let manifestPath = charDir.appendingPathComponent("manifest.json")
            if FileManager.default.fileExists(atPath: manifestPath.path),
               let data = try? Data(contentsOf: manifestPath),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                if let char = parseManifest(json, id: entry) {
                    characters.append(char)
                }
            } else {
                if let char = detectCharacter(id: entry, dir: charDir) {
                    characters.append(char)
                }
            }
        }
    }

    private func parseManifest(_ json: [String: Any], id: String) -> CharacterInfo? {
        let name = json["name"] as? String ?? id.capitalized
        let typeStr = json["type"] as? String ?? "live2d"
        let type: ModelType = typeStr == "spine" ? .spine : typeStr == "mmd" ? .mmd : .live2d
        guard let skinsJson = json["skins"] as? [[String: Any]] else { return nil }

        var skins: [SkinInfo] = []
        for skinJson in skinsJson {
            let skinName = skinJson["name"] as? String ?? "默认"
            guard let modesJson = skinJson["modes"] as? [[String: Any]] else { continue }
            var modes: [ModeInfo] = []
            for modeJson in modesJson {
                let modeName = modeJson["name"] as? String ?? "默认"
                let path = modeJson["path"] as? String ?? "."
                modes.append(ModeInfo(name: modeName, path: path))
            }
            skins.append(SkinInfo(name: skinName, modes: modes))
        }

        return CharacterInfo(id: id, name: name, type: type, skins: skins)
    }

    private func detectCharacter(id: String, dir: URL) -> CharacterInfo? {
        let files = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        let type: ModelType
        if files.contains(where: { $0.hasSuffix(".model3.json") }) {
            type = .live2d
        } else if files.contains(where: { $0.hasSuffix(".pmx") || $0.hasSuffix(".pmd") }) {
            type = .mmd
        } else if files.contains(where: { $0.hasSuffix(".skel") }) {
            type = .spine
        } else {
            return nil
        }
        let skins = [SkinInfo(name: "默认", modes: [ModeInfo(name: "默认", path: ".")])]
        return CharacterInfo(id: id, name: id.capitalized, type: type, skins: skins)
    }

    func switchModel(_ modelId: String) {
        guard modelId != currentModel else { return }
        saveChatHistory()
        currentModel = modelId
        UserDefaults.standard.set(modelId, forKey: "currentModel")
        expressions = []
        motionGroups = [:]
        voiceLines = []
        skills = []
        messages = []

        let type = modelTypeFor(modelId)
        switch type {
        case .mmd:
            triggerAction?("__RELOAD_MMD__:\(modelId)")
        case .spine:
            triggerAction?("__RELOAD_SPINE__:\(modelId)")
        case .live2d:
            triggerAction?("__RELOAD_LIVE2D__:\(modelId)")
        }

        loadVoiceLines()
        loadSkills()
        loadPersona()
        loadChatHistory()
    }

    func setGlobalScale(_ scale: Double) {
        globalScale = scale
        UserDefaults.standard.set(scale, forKey: "globalScale")
        triggerAction?("setUserScale(\(scale))")
    }

    func modelTypeFor(_ modelId: String) -> ModelType {
        let charId = modelId.contains("/") ? String(modelId.split(separator: "/").first!) : modelId
        return characters.first { $0.id == charId }?.type ?? .live2d
    }

    func findWebDirectory() -> URL? {
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

    func send(_ text: String) {
        let msg = ChatMessage(role: .user, content: text)
        messages.append(msg)
        isThinking = true

        affection = min(affection + 2, 100)
        totalChats += 1
        let today = Self.todayString()
        if lastChatDate != today {
            lastChatDate = today
            todayChats = 1
        } else {
            todayChats += 1
        }

        if let engine = chatEngine {
            chatTask?.cancel()
            chatTask = Task {
                var accumulated = ""
                for await delta in engine.send(message: text, history: messages) {
                    switch delta {
                    case .text(let chunk):
                        accumulated += chunk
                        if let lastIdx = messages.indices.last, messages[lastIdx].role == .assistant {
                            messages[lastIdx].content = accumulated
                        } else {
                            messages.append(ChatMessage(role: .assistant, content: accumulated))
                        }
                    case .done:
                        isThinking = false
                    case .error(let err):
                        messages.append(ChatMessage(role: .system, content: err))
                        isThinking = false
                    }
                }
                isThinking = false
                saveChatHistory()
            }
        } else if isConnected {
            let payload: [String: Any] = ["type": "chat", "content": text]
            if let data = try? JSONSerialization.data(withJSONObject: payload),
               let str = String(data: data, encoding: .utf8) {
                wsClient?.send(str)
            }
        } else {
            messages.append(ChatMessage(role: .system, content: "未配置 AI（设置中添加 API Key）"))
            isThinking = false
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

    var currentCharId: String {
        if currentModel.contains("/") {
            return String(currentModel.split(separator: "/").first!)
        }
        return currentModel
    }

    func loadVoiceLines() {
        voiceLines = []
        guard let webDir = findWebDirectory() else { return }
        let voicePath = webDir.appendingPathComponent("model/\(currentCharId)/voice_lines.json")
        guard FileManager.default.fileExists(atPath: voicePath.path),
              let data = try? Data(contentsOf: voicePath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let lines = json["voiceLines"] as? [[String: Any]] else { return }
        var result: [VoiceLine] = []
        for line in lines {
            let key = line["key"] as? String ?? ""
            let title = line["title"] as? String ?? ""
            let content = line["content"] as? String ?? ""
            let audioFile = line["audioFile"] as? String ?? ""
            result.append(VoiceLine(key: key, title: title, content: content, audioFile: audioFile))
        }
        voiceLines = result
        debugLog("Loaded \(result.count) voice lines for \(currentCharId)")
    }

    func loadSkills() {
        skills = []
        guard let webDir = findWebDirectory() else { return }
        let skillsPath = webDir.appendingPathComponent("model/\(currentCharId)/skills.json")
        guard FileManager.default.fileExists(atPath: skillsPath.path),
              let data = try? Data(contentsOf: skillsPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let skillsArr = json["skills"] as? [[String: Any]] else { return }
        var result: [SkillInfo] = []
        for s in skillsArr {
            let name = s["name"] as? String ?? ""
            let desc = s["description"] as? String ?? ""
            let icon = s["icon"] as? String ?? "star.fill"
            let animation = s["animation"] as? String ?? ""
            let voiceLine = s["voiceLine"] as? String ?? ""
            let audioFile = s["audioFile"] as? String ?? ""
            result.append(SkillInfo(name: name, description: desc, icon: icon, animation: animation, voiceLine: voiceLine, audioFile: audioFile))
        }
        skills = result
        debugLog("Loaded \(result.count) skills for \(currentCharId)")
    }

    func playVoiceAudio(_ audioFile: String) {
        guard !audioFile.isEmpty, let webDir = findWebDirectory() else { return }
        let audioPath = webDir.appendingPathComponent("model/\(currentCharId)/voice/\(audioFile)")
        guard FileManager.default.fileExists(atPath: audioPath.path) else {
            debugLog("Audio file not found: \(audioPath.path)")
            return
        }
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: audioPath)
            audioPlayer?.play()
        } catch {
            debugLog("Failed to play audio: \(error)")
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

struct ChatMessage: Identifiable, Codable {
    let id: UUID
    let role: Role
    var content: String

    init(role: Role, content: String) {
        self.id = UUID()
        self.role = role
        self.content = content
    }

    enum Role: String, Codable {
        case user, assistant, system
    }
}

enum ModelType {
    case live2d, mmd, spine
}

struct CharacterInfo: Identifiable {
    let id: String
    let name: String
    let type: ModelType
    let skins: [SkinInfo]

    var isSingleMode: Bool {
        skins.count == 1 && skins[0].modes.count == 1 && skins[0].modes[0].name == "默认"
    }
}

struct SkinInfo {
    let name: String
    let modes: [ModeInfo]
}

struct ModeInfo {
    let name: String
    let path: String
}

struct VoiceLine: Identifiable {
    let id = UUID()
    let key: String
    let title: String
    let content: String
    let audioFile: String
}

struct VoiceLinesData {
    let name: String
    let voiceLines: [VoiceLine]
}

struct SkillInfo: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let icon: String
    let animation: String
    let voiceLine: String
    let audioFile: String
}
