import Foundation

/// Only Ricotta's own HTTPS pages are hosted inside the app. No native JavaScript bridge is exposed.
enum RicottaNavigation {
    static let home = URL(string: "https://rozhzero969-hub.github.io/Ricotta/")!
    static func isAppPage(_ url: URL) -> Bool {
        let path = url.path
        guard !path.contains("\\"), !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return false }
        return url.scheme?.lowercased() == "https" && url.host?.lowercased() == home.host &&
        url.user == nil && url.password == nil && (url.port == nil || url.port == 443) &&
        (url.path == "/Ricotta" || url.path.hasPrefix("/Ricotta/"))
    }
    static func isAppBlob(_ url: URL) -> Bool {
        guard url.scheme == "blob", let origin = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        return origin.scheme == "https" && origin.host == home.host && origin.user == nil &&
            origin.password == nil && (origin.port == nil || origin.port == 443)
    }
    static func isExternalLink(_ url: URL) -> Bool {
        ["https", "mailto", "tel", "whatsapp"].contains(url.scheme?.lowercased() ?? "")
    }
    static func isChallengeFrame(_ url: URL) -> Bool {
        ["about:blank", "about:srcdoc"].contains(url.absoluteString) ||
        (url.scheme == "https" && url.host == "challenges.cloudflare.com") || isAppPage(url)
    }
}
