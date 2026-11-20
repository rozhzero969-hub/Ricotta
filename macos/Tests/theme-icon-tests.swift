import AppKit

/// Only these theme and icon names reach the page or the Dock; they match sounds.js (MAC_THEMES, MAC_ICONS).
func checkChoices() {
    expect(AppTheme.allCases.map(\.rawValue) == ["ricotta", "halloween", "christmas", "moonlit", "google", "pink"], "the six themes")
    for old in ["graphite", "ocean", "rose", "sand", "midnight", "discord", "", "<b>"] { expect(AppTheme(rawValue: old) == nil, "no theme \(old)") }
    let icons = ["ricotta", "pumpkin", "holly", "moonlit", "gemini", "cupid", "monogram", "ticket", "aurora", "frost", "copper", "stamp"]
    expect(AppIconChoice.allCases.map(\.rawValue) == icons, "theme icons first, in theme order, then the others")
    expect(AppIconChoice.allCases.filter(\.isThemeIcon).count == AppTheme.allCases.count, "one icon per theme")
    for old in ["green", "halloween", "christmas", "discord", "google", "pink", "cream", "forest", "wordmark", "slip", "wedge", "bag", "glass", "dark", "evil"] { expect(AppIconChoice(rawValue: old) == nil, "no icon \(old)") }
    for icon in AppIconChoice.allCases {
        let set = URL(fileURLWithPath: "macos/Ricotta/Assets.xcassets/\(icon.assetName).imageset/\(icon.assetName)@2x.png")
        expect(FileManager.default.fileExists(atPath: set.path), "artwork for \(icon.rawValue)")
        expect(FileManager.default.fileExists(atPath: "mac-icons/\(icon.rawValue).png"), "website preview for \(icon.rawValue)")
    }
    let sounds = (try? String(contentsOfFile: "sounds.js", encoding: .utf8)) ?? ""
    expect(sounds.contains("const MAC_THEMES = ['ricotta','halloween','christmas','moonlit','google','pink'];"), "sounds.js has the same themes")
    expect(sounds.contains("const MAC_ICONS = [" + icons.map { "'\($0)'" }.joined(separator: ",") + "];"), "sounds.js has the same icons")
    print("PASS (Mac): six themes and twelve icons, the same names as the page, artwork for each")
}
