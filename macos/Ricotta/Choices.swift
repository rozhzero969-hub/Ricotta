import AppKit

/// The Dock icons (Assets.xcassets, AppIcon-<name>): one for each theme first (in AppTheme order), then the
/// others. The first is the default; a saved name that no longer exists reads as it.
enum AppIconChoice: String, CaseIterable {
    case ricotta
    case cosmetic_ink = "cosmetic-ink"
    case cosmetic_pearl = "cosmetic-pearl"
    case cosmetic_signature = "cosmetic-signature"
    case beauty_feather = "beauty-feather"
    case beauty_gold = "beauty-gold"
    case beauty_signature = "beauty-signature"
    case ricotta_mark = "ricotta-mark"
    case ricotta_cheese = "ricotta-cheese"
    case ricotta_word = "ricotta-word"

    var assetName: String { "AppIcon-\(rawValue)" }
    var title: String {
        switch self {
        case .ricotta: String(localized: "Default Ricotta")
        case .cosmetic_ink: String(localized: "Ink")
        case .cosmetic_pearl: String(localized: "Pearl")
        case .cosmetic_signature: String(localized: "Cosmetic Signature")
        case .beauty_feather: String(localized: "Gold Feather")
        case .beauty_gold: String(localized: "Golden S")
        case .beauty_signature: String(localized: "Beauty Signature")
        case .ricotta_mark: String(localized: "Ricotta R")
        case .ricotta_cheese: String(localized: "Ricotta Cheese")
        case .ricotta_word: String(localized: "Ricotta Wordmark")
        }
    }

    /// The supplied square artwork sits in the same rounded footprint as the default Dock icon.
    func dockImage() -> NSImage? {
        guard let source = NSImage(named: assetName) else { return nil }
        if self == .ricotta { return source }
        return NSImage(size: NSSize(width: 512, height: 512), flipped: false) { rect in
            let tile = rect.insetBy(dx: 26, dy: 26)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: tile, xRadius: 103, yRadius: 103).addClip()
            source.draw(in: tile, from: .zero, operation: .sourceOver, fraction: 1)
            NSGraphicsContext.restoreGraphicsState()
            return true
        }
    }

    func preview(size: CGFloat) -> NSImage? {
        guard let icon = dockImage() else { return nil }
        return NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
            icon.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
    }
}

/// The page's colour themes (style.css, html.theme-<name>), chosen here or in Ricotta's Settings.
/// Raw values match the web theme classes.
enum AppTheme: String, CaseIterable {
    case ricotta, cosmetic, beauty
    var title: String {
        switch self {
        case .ricotta: String(localized: "Ricotta")
        case .cosmetic: String(localized: "Shayda Cosmetic")
        case .beauty: String(localized: "Shayda Beauty")
        }
    }
    var colors: (NSColor, NSColor?) {
        switch self {
        case .ricotta: (Self.rgb(0x135B43), Self.rgb(0xF6F2DC))
        case .cosmetic: (Self.rgb(0x28282E), Self.rgb(0xF4F4F8))
        case .beauty: (Self.rgb(0x285045), Self.rgb(0xE5BF5B))
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
