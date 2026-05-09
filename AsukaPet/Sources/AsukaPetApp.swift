import SwiftUI

@main
struct AsukaPetApp: App {
    @StateObject private var petState = PetState.shared
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        MenuBarExtra("Asuka", systemImage: "sparkle") {
            Toggle("显示桌宠", isOn: $petState.isVisible)
                .keyboardShortcut("p", modifiers: [.command, .shift])
                .onChange(of: petState.isVisible) { _, visible in
                    if visible {
                        appDelegate.petPanel?.orderFront(nil)
                    } else {
                        appDelegate.petPanel?.orderOut(nil)
                    }
                }
            Toggle("点击穿透", isOn: $petState.clickThrough)
                .onChange(of: petState.clickThrough) { _, through in
                    appDelegate.petPanel?.ignoresMouseEvents = through
                }
            Divider()
            Menu("切换模型") {
                ForEach(petState.availableModels) { model in
                    Button(action: { petState.switchModel(model.id) }) {
                        HStack {
                            Text(model.name)
                            if model.id == petState.currentModel {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            }
            Divider()
            Button("清空对话") {
                petState.clearConversation()
            }
            Divider()
            HStack {
                Circle()
                    .fill(petState.isConnected ? .green : .red)
                    .frame(width: 8, height: 8)
                Text("ws://127.0.0.1:8765")
            }
            Divider()
            Button("退出") {
                NSApplication.shared.terminate(nil)
            }
            .keyboardShortcut("q")
        }

        // 使用 Settings scene 作为占位（实际窗口由 AppDelegate 管理）
        Settings {
            EmptyView()
        }
    }
}

/// AppDelegate 负责创建透明置顶的 NSPanel 窗口
@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    var petPanel: NSPanel?
    var petState: PetState?

    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.createPetWindow()
        }
    }

    func createPetWindow() {
        let panel = KeyablePanel(
            contentRect: NSRect(x: 0, y: 0, width: 480, height: 500),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        panel.isFloatingPanel = true
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

        // 定位到屏幕右下角
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let x = screenFrame.maxX - 500
            let y = screenFrame.minY + 20
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        }

        let hostingView = NSHostingView(rootView: PetWindowContent())
        hostingView.frame = panel.contentView?.bounds ?? .zero
        hostingView.autoresizingMask = [.width, .height]
        panel.contentView = hostingView

        panel.orderFront(nil)
        self.petPanel = panel
    }
}

/// 独立的窗口内容视图（不依赖 EnvironmentObject，通过单例 PetState 获取状态）
struct PetWindowContent: View {
    @StateObject private var petState = PetState.shared

    var body: some View {
        PetWindowView()
            .environmentObject(petState)
    }
}

/// 自定义 Panel，允许接收键盘输入
class KeyablePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
