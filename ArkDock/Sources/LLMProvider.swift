import Foundation

enum ProviderType: String, CaseIterable, Codable {
    case anthropic = "anthropic"
    case openAICompatible = "openai"
}

struct LLMConfig: Codable {
    var provider: ProviderType
    var endpoint: String
    var apiKey: String
    var model: String

    static let defaultAnthropic = LLMConfig(
        provider: .anthropic,
        endpoint: "https://api.anthropic.com",
        apiKey: "",
        model: "claude-sonnet-4-20250514"
    )

    static let defaultOpenAI = LLMConfig(
        provider: .openAICompatible,
        endpoint: "https://api.openai.com",
        apiKey: "",
        model: "gpt-4o-mini"
    )

    var isConfigured: Bool {
        !apiKey.isEmpty
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            UserDefaults.standard.set(data, forKey: "llmConfig")
        }
    }

    static func load() -> LLMConfig? {
        guard let data = UserDefaults.standard.data(forKey: "llmConfig"),
              let config = try? JSONDecoder().decode(LLMConfig.self, from: data) else {
            return nil
        }
        return config
    }
}

final class LLMProvider: Sendable {
    let config: LLMConfig

    init(config: LLMConfig) {
        self.config = config
    }

    func stream(system: String, messages: [[String: String]]) -> AsyncThrowingStream<String, Error> {
        let config = self.config
        let system = system
        let messages = messages
        switch config.provider {
        case .anthropic:
            return Self.streamAnthropic(config: config, system: system, messages: messages)
        case .openAICompatible:
            return Self.streamOpenAI(config: config, system: system, messages: messages)
        }
    }

    // MARK: - Anthropic Messages API

    private static func streamAnthropic(config: LLMConfig, system: String, messages: [[String: String]]) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let url = URL(string: "\(config.endpoint)/v1/messages")!
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue(config.apiKey, forHTTPHeaderField: "x-api-key")
                    request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

                    let body: [String: Any] = [
                        "model": config.model,
                        "max_tokens": 256,
                        "system": system,
                        "messages": messages,
                        "stream": true
                    ]
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let httpResp = response as? HTTPURLResponse else {
                        throw LLMError.invalidResponse
                    }
                    if httpResp.statusCode != 200 {
                        var errorBody = ""
                        for try await line in bytes.lines { errorBody += line }
                        throw LLMError.apiError(httpResp.statusCode, errorBody)
                    }

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let jsonStr = String(line.dropFirst(6))
                        if jsonStr == "[DONE]" { break }
                        guard let data = jsonStr.data(using: .utf8),
                              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

                        let eventType = event["type"] as? String ?? ""
                        if eventType == "content_block_delta",
                           let delta = event["delta"] as? [String: Any],
                           let text = delta["text"] as? String {
                            continuation.yield(text)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }

    // MARK: - OpenAI-compatible API (Azure, DeepSeek, Kimi, etc.)

    private static func streamOpenAI(config: LLMConfig, system: String, messages: [[String: String]]) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let endpoint = config.endpoint.hasSuffix("/") ? String(config.endpoint.dropLast()) : config.endpoint
                    let url = URL(string: "\(endpoint)/v1/chat/completions")!
                    var request = URLRequest(url: url)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")

                    var allMessages: [[String: String]] = [["role": "system", "content": system]]
                    allMessages.append(contentsOf: messages)

                    let body: [String: Any] = [
                        "model": config.model,
                        "max_tokens": 256,
                        "messages": allMessages,
                        "stream": true
                    ]
                    request.httpBody = try JSONSerialization.data(withJSONObject: body)

                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let httpResp = response as? HTTPURLResponse else {
                        throw LLMError.invalidResponse
                    }
                    if httpResp.statusCode != 200 {
                        var errorBody = ""
                        for try await line in bytes.lines { errorBody += line }
                        throw LLMError.apiError(httpResp.statusCode, errorBody)
                    }

                    for try await line in bytes.lines {
                        guard line.hasPrefix("data: ") else { continue }
                        let jsonStr = String(line.dropFirst(6))
                        if jsonStr == "[DONE]" { break }
                        guard let data = jsonStr.data(using: .utf8),
                              let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

                        if let choices = event["choices"] as? [[String: Any]],
                           let first = choices.first,
                           let delta = first["delta"] as? [String: Any],
                           let content = delta["content"] as? String {
                            continuation.yield(content)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}

enum LLMError: LocalizedError {
    case invalidResponse
    case apiError(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Invalid response"
        case .apiError(let code, let msg): return "API error \(code): \(msg.prefix(100))"
        }
    }
}
