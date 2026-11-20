import AppKit

/// The six Dock icons (Assets.xcassets, AppIcon-<name>) in theme order.
enum AppIconChoice: String, CaseIterable {
    case green, halloween, christmas, discord, google, pink

    var assetName: String { "AppIcon-\(rawValue)" }

    var title: String {
        switch self {
        case .green: String(localized: "Basil Leaf")
        case .halloween: String(localized: "Jack & Moon")
        case .christmas: String(localized: "Holly Bauble")
        case .discord: String(localized: "Lunar Orbit")
        case .google: String(localized: "Sunny Side")
        case .pink: String(localized: "Bow Bear")
        }
    }

    func preview(size: CGFloat) -> NSImage? {
        guard let image = NSImage(named: assetName)?.copy() as? NSImage else { return nil }
        image.size = NSSize(width: size, height: size)
        return image
    }
}

/// The page's colour themes (style.css, html.theme-<name>), chosen here or in Ricotta's Settings.
/// Raw values match existing preferences and web theme classes.
enum AppTheme: String, CaseIterable {
    case ricotta, halloween, christmas, discord, google, pink
    var title: String {
        switch self {
        case .ricotta: String(localized: "Ricotta Verde")
        case .halloween: String(localized: "Pumpkin Hour")
        case .christmas: String(localized: "Winter Holly")
        case .discord: String(localized: "Moonlit Pantry")
        case .google: String(localized: "Apricot Coast")
        case .pink: String(localized: "Cupid’s Kitchen")
        }
    }
    /// The theme's button colour and, for the two-tone themes, its second colour, as in style.css.
    var colors: (NSColor, NSColor?) {
        switch self {
        case .ricotta: (Self.rgb(0x1F7A4D), nil)
        case .halloween: (Self.rgb(0xEE9B57), Self.rgb(0x49264F))
        case .christmas: (Self.rgb(0xD88C9D), Self.rgb(0x153E34))
        case .discord: (Self.rgb(0xA9A0EC), Self.rgb(0x302456))
        case .google: (Self.rgb(0x67B6B3), Self.rgb(0xFFDB88))
        case .pink: (Self.rgb(0xEAB3C9), Self.rgb(0x8F3B60))
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
