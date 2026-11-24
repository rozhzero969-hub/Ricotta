import AppKit

/// Only these theme and icon names reach the page or the Dock; they match sounds.js (MAC_THEMES, MAC_ICONS).
func checkChoices() {
    expect(AppTheme.allCases.map(\.rawValue) == ["ricotta", "cosmetic", "beauty"], "the three themes")
    for old in ["graphite", "ocean", "rose", "sand", "midnight", "discord", "", "<b>"] { expect(AppTheme(rawValue: old) == nil, "no theme \(old)") }
    let icons = ["ricotta", "cosmetic-ink", "cosmetic-pearl", "cosmetic-signature", "beauty-feather", "beauty-gold", "beauty-signature", "ricotta-mark", "ricotta-cheese", "ricotta-word"]
    expect(AppIconChoice.allCases.map(\.rawValue) == icons, "default and the nine supplied icons")
    for old in ["green", "halloween", "christmas", "discord", "google", "pink", "cream", "forest", "wordmark", "slip", "wedge", "bag", "glass", "dark", "evil"] { expect(AppIconChoice(rawValue: old) == nil, "no icon \(old)") }
    for icon in AppIconChoice.allCases {
        let set = URL(fileURLWithPath: "macos/Ricotta/Assets.xcassets/\(icon.assetName).imageset/\(icon.assetName)@2x.png")
        expect(FileManager.default.fileExists(atPath: set.path), "artwork for \(icon.rawValue)")
        expect(FileManager.default.fileExists(atPath: "mac-icons/\(icon.rawValue).png"), "website preview for \(icon.rawValue)")
    }
    let sounds = (try? String(contentsOfFile: "sounds.js", encoding: .utf8)) ?? ""
    expect(sounds.contains("const MAC_THEMES = ['ricotta','cosmetic','beauty'];"), "same theme names in the web app")
    for icon in icons { expect(sounds.contains("'" + icon + "'"), "web support for " + icon) }
    print("PASS (Mac): three themes and ten bundled icons")
}
