// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ArkDock",
    platforms: [.macOS("15.0")],
    targets: [
        .executableTarget(
            name: "ArkDock",
            path: "Sources",
            resources: [
                .copy("web"),
            ]
        ),
    ]
)
