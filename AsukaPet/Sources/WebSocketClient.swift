import Foundation

/// WebSocket 客户端，连接本地 asuka 后端
final class WebSocketClient: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let url: URL
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private let onMessage: @Sendable (String) -> Void
    private let onConnect: @Sendable () -> Void
    private let onDisconnect: @Sendable () -> Void
    private var shouldReconnect = true

    init(url: URL,
         onMessage: @escaping @Sendable (String) -> Void,
         onConnect: @escaping @Sendable () -> Void,
         onDisconnect: @escaping @Sendable () -> Void) {
        self.url = url
        self.onMessage = onMessage
        self.onConnect = onConnect
        self.onDisconnect = onDisconnect
        super.init()
        self.session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func connect() {
        webSocketTask = session?.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
    }

    func disconnect() {
        shouldReconnect = false
        webSocketTask?.cancel(with: .goingAway, reason: nil)
    }

    func send(_ text: String) {
        webSocketTask?.send(.string(text)) { error in
            if let error {
                print("[WS] 发送失败: \(error)")
            }
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.onMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self.onMessage(text)
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure(let error):
                print("[WS] 接收失败: \(error)")
                self.onDisconnect()
                self.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() {
        guard shouldReconnect else { return }
        DispatchQueue.global().asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.connect()
        }
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        onConnect()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        onDisconnect()
        scheduleReconnect()
    }
}
