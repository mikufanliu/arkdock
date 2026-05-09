// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AsukaPet",
    platforms: [.macOS("15.0")],
    targets: [
        .executableTarget(
            name: "AsukaPet",
            path: "Sources",
            resources: [
                .copy("web"),
            ]
        ),
    ]
)
