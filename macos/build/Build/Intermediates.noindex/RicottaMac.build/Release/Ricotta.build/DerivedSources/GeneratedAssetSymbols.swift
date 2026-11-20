import Foundation
#if canImport(DeveloperToolsSupport)
import DeveloperToolsSupport
#endif

#if SWIFT_PACKAGE
private let resourceBundle = Foundation.Bundle.module
#else
private class ResourceBundleClass {}
private let resourceBundle = Foundation.Bundle(for: ResourceBundleClass.self)
#endif

// MARK: - Color Symbols -

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension DeveloperToolsSupport.ColorResource {

    /// The "AccentColor" asset catalog color resource.
    static let accent = DeveloperToolsSupport.ColorResource(name: "AccentColor", bundle: resourceBundle)

}

// MARK: - Image Symbols -

@available(iOS 17.0, macOS 14.0, tvOS 17.0, watchOS 10.0, *)
extension DeveloperToolsSupport.ImageResource {

    /// The "AppIcon-dark" asset catalog image resource.
    static let appIconDark = DeveloperToolsSupport.ImageResource(name: "AppIcon-dark", bundle: resourceBundle)

    /// The "AppIcon-green" asset catalog image resource.
    static let appIconGreen = DeveloperToolsSupport.ImageResource(name: "AppIcon-green", bundle: resourceBundle)

    /// The "AppIcon-light" asset catalog image resource.
    static let appIconLight = DeveloperToolsSupport.ImageResource(name: "AppIcon-light", bundle: resourceBundle)

    /// The "AppIcon-mint" asset catalog image resource.
    static let appIconMint = DeveloperToolsSupport.ImageResource(name: "AppIcon-mint", bundle: resourceBundle)

    /// The "AppIcon-sky" asset catalog image resource.
    static let appIconSky = DeveloperToolsSupport.ImageResource(name: "AppIcon-sky", bundle: resourceBundle)

    /// The "AppIcon-wordmark" asset catalog image resource.
    static let appIconWordmark = DeveloperToolsSupport.ImageResource(name: "AppIcon-wordmark", bundle: resourceBundle)

    /// The "LoadingLogo" asset catalog image resource.
    static let loadingLogo = DeveloperToolsSupport.ImageResource(name: "LoadingLogo", bundle: resourceBundle)

}

