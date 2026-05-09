import Foundation
import Network

/// 轻量本地 HTTP 服务，服务 web/ 目录静态文件给 WKWebView
final class LocalHTTPServer: @unchecked Sendable {
    nonisolated(unsafe) static let shared = LocalHTTPServer()

    let port: UInt16 = 9876
    private var listener: NWListener?
    private var webDirectory: URL?

    var baseURL: URL {
        URL(string: "http://127.0.0.1:\(port)")!
    }

    func start(servingDirectory dir: URL) {
        webDirectory = dir

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true

        do {
            listener = try NWListener(using: params, on: NWEndpoint.Port(rawValue: port)!)
        } catch {
            debugLog("HTTP server failed to create listener: \(error)")
            return
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.stateUpdateHandler = { state in
            switch state {
            case .ready:
                debugLog("HTTP server ready on port \(self.port)")
            case .failed(let error):
                debugLog("HTTP server failed: \(error)")
            default:
                break
            }
        }

        listener?.start(queue: .global(qos: .userInteractive))
    }

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: .global(qos: .userInteractive))

        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, _, error in
            guard let self, let data, error == nil else {
                connection.cancel()
                return
            }

            guard let request = String(data: data, encoding: .utf8) else {
                connection.cancel()
                return
            }

            let path = self.parseRequestPath(request)
            self.serveFile(path: path, connection: connection)
        }
    }

    private func parseRequestPath(_ request: String) -> String {
        let lines = request.components(separatedBy: "\r\n")
        guard let firstLine = lines.first else { return "/" }
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return "/" }
        let rawPath = String(parts[1])
        if let decoded = rawPath.removingPercentEncoding {
            return decoded
        }
        return rawPath
    }

    private func serveFile(path: String, connection: NWConnection) {
        guard let webDir = webDirectory else {
            sendResponse(connection: connection, status: "500 Internal Server Error", contentType: "text/plain", body: Data("No web directory".utf8))
            return
        }

        var filePath = path
        if filePath == "/" { filePath = "/index.html" }

        let fileURL = webDir.appendingPathComponent(filePath)

        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: fileURL.path, isDirectory: &isDir), isDir.boolValue {
            let entries = (try? FileManager.default.contentsOfDirectory(atPath: fileURL.path)) ?? []
            let html = entries.map { "<a href=\"\($0)\">\($0)</a>" }.joined(separator: "\n")
            sendResponse(connection: connection, status: "200 OK", contentType: "text/html; charset=utf-8", body: Data(html.utf8))
            return
        }

        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            sendResponse(connection: connection, status: "404 Not Found", contentType: "text/plain", body: Data("Not found: \(filePath)".utf8))
            return
        }

        guard let fileData = try? Data(contentsOf: fileURL) else {
            sendResponse(connection: connection, status: "500 Internal Server Error", contentType: "text/plain", body: Data("Read error".utf8))
            return
        }

        let contentType = mimeType(for: fileURL.pathExtension)
        sendResponse(connection: connection, status: "200 OK", contentType: contentType, body: fileData)
    }

    private func sendResponse(connection: NWConnection, status: String, contentType: String, body: Data) {
        var header = "HTTP/1.1 \(status)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "Connection: close\r\n"
        header += "\r\n"

        var responseData = Data(header.utf8)
        responseData.append(body)

        connection.send(content: responseData, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "moc3": return "application/octet-stream"
        case "css": return "text/css"
        case "pmd", "pmx", "vmd", "vpd", "bmp", "tga", "spa", "sph":
            return "application/octet-stream"
        case "glb": return "model/gltf-binary"
        case "gltf": return "model/gltf+json"
        default: return "application/octet-stream"
        }
    }
}
