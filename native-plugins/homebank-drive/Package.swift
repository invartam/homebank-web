// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HomebankCapacitorDrive",
    platforms: [.iOS(.v15)],
    products: [.library(name: "HomebankCapacitorDrive", targets: ["HomeBankDrivePlugin"])],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.4.3"),
        .package(url: "https://github.com/openid/AppAuth-iOS.git", exact: "2.0.0")
    ],
    targets: [.target(name: "HomeBankDrivePlugin", dependencies: [
            .product(name: "Capacitor", package: "capacitor-swift-pm"),
            .product(name: "Cordova", package: "capacitor-swift-pm"),
        .product(name: "AppAuth", package: "AppAuth-iOS")
    ], path: "ios/Sources/HomeBankDrivePlugin")]
)
