import AppKit

/// The Dock icon choices (Assets.xcassets, AppIcon-<name>, drawn from macos/IconSources; see the README).
/// The first six match the themes, in AppTheme order; the rest are other looks.
enum AppIconChoice: String, CaseIterable {
    case green, halloween, christmas, discord, google, pink
    case cream, forest, wordmark, slip, wedge, bag, glass, dark
    static let themeIcons: [AppIconChoice] = [.green, .halloween, .christmas, .discord, .google, .pink]
    static var moreIcons: [AppIconChoice] { allCases.filter { !themeIcons.contains($0) } }
    var assetName: String { "AppIcon-\(rawValue)" }
    var title: String {
        switch self {
        case .green: String(localized: "Ricotta")
        case .halloween: String(localized: "Halloween")
        case .christmas: String(localized: "Christmas")
        case .discord: "Discord"
        case .google: "Google"
        case .pink: String(localized: "Pink")
        case .cream: String(localized: "Cream")
        case .forest: String(localized: "Forest")
        case .wordmark: String(localized: "Wordmark")
        case .slip: String(localized: "Order Slip")
        case .wedge: String(localized: "Cheese")
        case .bag: String(localized: "Bag")
        case .glass: String(localized: "Glass")
        case .dark: String(localized: "Dark")
        }
    }
    func preview(size: CGFloat) -> NSImage? {
        guard let image = NSImage(named: assetName)?.copy() as? NSImage else { return nil }
        image.size = NSSize(width: size, height: size)
        return image
    }
}

/// The page's colour themes (style.css, html.theme-<name>), chosen here or in Ricotta's Settings.
/// Colours only: Discord and Google are palettes in their style, with no logos.
enum AppTheme: String, CaseIterable {
    case ricotta, halloween, christmas, discord, google, pink
    var title: String {
        switch self {
        case .ricotta: String(localized: "Ricotta")
        case .halloween: String(localized: "Halloween")
        case .christmas: String(localized: "Christmas")
        case .discord: "Discord"
        case .google: "Google"
        case .pink: String(localized: "Pink")
        }
    }
    /// The theme's button colour and, for the two-tone themes, its second colour, as in style.css.
    var colors: (NSColor, NSColor?) {
        switch self {
        case .ricotta: (Self.rgb(0x1F7A4D), nil)
        case .halloween: (Self.rgb(0xF97316), Self.rgb(0x2B1638))
        case .christmas: (Self.rgb(0xA51D35), Self.rgb(0x123F2B))
        case .discord: (Self.rgb(0x5865F2), nil)
        case .google: (Self.rgb(0x1A73E8), nil)
        case .pink: (Self.rgb(0xF7A1C0), Self.rgb(0xB0124F))
        }
    }
    private static func rgb(_ hex: Int) -> NSColor {
        NSColor(srgbRed: CGFloat(hex >> 16 & 255) / 255, green: CGFloat(hex >> 8 & 255) / 255, blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    var swatch: NSImage {
        NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            let circle = NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5))
            self.colors.0.setFill()
            circle.fill()
            if let second = self.colors.1 {
                NSGraphicsContext.saveGraphicsState()
                circle.addClip()
                let half = NSBezierPath()
                half.move(to: NSPoint(x: rect.maxX, y: rect.maxY))
                half.line(to: NSPoint(x: rect.maxX, y: rect.minY))
                half.line(to: NSPoint(x: rect.minX, y: rect.minY))
                half.close()
                second.setFill()
                half.fill()
                NSGraphicsContext.restoreGraphicsState()
            }
            return true
        }
    }
}
