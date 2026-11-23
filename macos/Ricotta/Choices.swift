import AppKit

/// The Dock icons (Assets.xcassets, AppIcon-<name>): one for each theme first (in AppTheme order), then the
/// others. The first is the default; a saved name that no longer exists reads as it.
enum AppIconChoice: String, CaseIterable {
    case ricotta, pumpkin, holly, moonlit, gemini, cupid, discord

    var assetName: String { "AppIcon-\(rawValue)" }

    var title: String {
        switch self {
        case .ricotta: String(localized: "Ricotta")
        case .pumpkin: String(localized: "Pumpkin Moon")
        case .holly: String(localized: "Winter Lights")
        case .moonlit: String(localized: "Silver Moon")
        case .gemini: String(localized: "Gemini")
        case .cupid: String(localized: "Cupid’s Blush")
        case .discord: String(localized: "Discord · Ricotta")
        }
    }
    /// Theme icons come first in the menu; the rest follow after a separator.
    var isThemeIcon: Bool { (Self.allCases.firstIndex(of: self) ?? 0) < AppTheme.allCases.count }

    func preview(size: CGFloat) -> NSImage? {
        guard let image = NSImage(named: assetName)?.copy() as? NSImage else { return nil }
        image.size = NSSize(width: size, height: size)
        return image
    }
}

/// The page's colour themes (style.css, html.theme-<name>), chosen here or in Ricotta's Settings.
/// Raw values match the web theme classes.
enum AppTheme: String, CaseIterable {
    case ricotta, halloween, christmas, moonlit, google, pink, discord
    var title: String {
        switch self {
        case .ricotta: String(localized: "Ricotta")
        case .halloween: String(localized: "Pumpkin Moon")
        case .christmas: String(localized: "Winter Lights")
        case .moonlit: String(localized: "Silver Moon")
        case .google: String(localized: "Google")
        case .pink: String(localized: "Cupid’s Blush")
        case .discord: String(localized: "Discord")
        }
    }
    /// The theme's main colour and its second colour, as in style.css (the menu's small swatch).
    var colors: (NSColor, NSColor?) {
        switch self {
        case .ricotta: (Self.rgb(0x1F7A4D), nil)
        case .halloween: (Self.rgb(0xF28C28), Self.rgb(0x2A1638))
        case .christmas: (Self.rgb(0xB3122E), Self.rgb(0x0F3B2A))
        case .moonlit: (Self.rgb(0xC9D6F2), Self.rgb(0x13224A))
        case .google: (Self.rgb(0x1A73E8), Self.rgb(0xFBBC05))
        case .pink: (Self.rgb(0xF7B8CF), Self.rgb(0xC2457A))
        case .discord: (Self.rgb(0xAEB6FF), Self.rgb(0x252633))
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
