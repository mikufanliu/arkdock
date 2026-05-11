import Foundation

struct Persona: Codable {
    let name: String
    let greeting: String
    let personality: String
    let systemPrompt: String
    let idleLines: [String]
    let tapLines: [String]
    let talkLines: [String]?
    let timeGreetings: [String: String]?
    let archives: [ArchiveEntry]?
    let profession: String?
    let subProfession: String?
}

struct ArchiveEntry: Codable {
    let title: String
    let content: String
}

protocol ChatEngine {
    func send(message: String, history: [ChatMessage]) -> AsyncStream<ChatDelta>
}

enum ChatDelta: Sendable {
    case text(String)
    case done
    case error(String)
}

// MARK: - Scripted Engine (no LLM required)

class ScriptedChatEngine: ChatEngine {
    let persona: Persona

    init(persona: Persona) {
        self.persona = persona
    }

    func send(message: String, history: [ChatMessage]) -> AsyncStream<ChatDelta> {
        let reply = pickReply(for: message)
        return AsyncStream { continuation in
            continuation.yield(.text(reply))
            continuation.yield(.done)
            continuation.finish()
        }
    }

    private func pickReply(for input: String) -> String {
        let lower = input.lowercased()

        if lower.contains("你好") || lower.contains("早上好") || lower.contains("晚上好") || lower.contains("hello") {
            return timeGreeting()
        }

        if lower.contains("谢") || lower.contains("感谢") || lower.contains("thank") {
            return persona.tapLines.randomElement() ?? "嗯。"
        }

        if lower.contains("名字") || lower.contains("谁") || lower.contains("叫什么") {
            return "......\(persona.name)。"
        }

        if lower.contains("晚安") || lower.contains("睡") {
            return persona.timeGreetings?["night"] ?? "......休息吧。"
        }

        // Gather all available lines for random selection
        var pool: [String] = []
        if let talks = persona.talkLines { pool.append(contentsOf: talks) }
        pool.append(contentsOf: persona.tapLines)
        pool.append(contentsOf: persona.idleLines)

        return pool.randomElement() ?? "......"
    }

    private func timeGreeting() -> String {
        let hour = Calendar.current.component(.hour, from: Date())
        let key: String
        switch hour {
        case 6..<12: key = "morning"
        case 12..<18: key = "afternoon"
        case 18..<22: key = "evening"
        default: key = "night"
        }
        return persona.timeGreetings?[key] ?? "嗯。"
    }
}

// MARK: - LLM Engine

class LLMChatEngine: ChatEngine {
    let persona: Persona
    let provider: LLMProvider

    init(persona: Persona, provider: LLMProvider) {
        self.persona = persona
        self.provider = provider
    }

    func send(message: String, history: [ChatMessage]) -> AsyncStream<ChatDelta> {
        let systemPrompt = persona.systemPrompt
        var apiMessages: [[String: String]] = []
        let recentHistory = history.suffix(20)
        for msg in recentHistory {
            switch msg.role {
            case .user:
                apiMessages.append(["role": "user", "content": msg.content])
            case .assistant:
                apiMessages.append(["role": "assistant", "content": msg.content])
            case .system:
                break
            }
        }
        apiMessages.append(["role": "user", "content": message])

        let provider = self.provider
        let messages = apiMessages
        return AsyncStream { continuation in
            Task { @Sendable in
                do {
                    for try await chunk in provider.stream(
                        system: systemPrompt,
                        messages: messages
                    ) {
                        continuation.yield(.text(chunk))
                    }
                    continuation.yield(.done)
                } catch {
                    continuation.yield(.error(error.localizedDescription))
                }
                continuation.finish()
            }
        }
    }
}
