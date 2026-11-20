import Foundation

/// Only Ricotta's own HTTPS pages are hosted inside the app (the same rules as the iPhone app,
/// ios/Ricotta/NavigationPolicy.swift). The message channel accepts fixed words only from these pages.
enum RicottaNavigation {
    static let live = URL(string: "https://rozhzero969-hub.github.io/Ricotta/")!

    /// Debug builds only: a local Ricotta Lab to test against before a website change is live, given as a
    /// launch argument (`-RicottaDevURL http://localhost:8765/`) or the `RICOTTA_DEV_URL` environment
    /// variable. Only this Mac's own loopback addresses are accepted. Release builds always load the live site.
    static let devHome: URL? = {
        #if DEBUG
        let value = ProcessInfo.processInfo.environment["RICOTTA_DEV_URL"] ?? UserDefaults.standard.string(forKey: "RicottaDevURL")
        guard let value, let url = URL(string: value), isLoopback(url) else { return nil }
        return url
        #else
        return nil
        #endif
    }()
    static var home: URL { devHome ?? live }

    static func isLoopback(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "") &&
        ["localhost", "127.0.0.1"].contains(url.host?.lowercased() ?? "") && url.user == nil && url.password == nil
    }
    private static func isDevPage(_ url: URL) -> Bool {
        guard let dev = devHome, isLoopback(url) else { return false }
        return url.scheme?.lowercased() == dev.scheme?.lowercased() && url.host?.lowercased() == dev.host?.lowercased() && url.port == dev.port
    }

    static func isAppPage(_ url: URL) -> Bool {
        let path = url.path
        guard !path.contains("\\"), !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }) else { return false }
        if isDevPage(url) { return true }
        return url.scheme?.lowercased() == "https" && url.host?.lowercased() == live.host &&
            url.user == nil && url.password == nil && (url.port == nil || url.port == 443) &&
            (path == "/Ricotta" || path.hasPrefix("/Ricotta/"))
    }
    /// Files the page makes itself (PDF and Excel exports) are blob: URLs of Ricotta's own origin.
    static func isAppBlob(_ url: URL) -> Bool {
        guard url.scheme == "blob", let origin = URL(string: String(url.absoluteString.dropFirst(5))) else { return false }
        if isDevPage(origin) { return true }
        return origin.scheme == "https" && origin.host == live.host && origin.user == nil &&
            origin.password == nil && (origin.port == nil || origin.port == 443)
    }
    /// Camera and microphone: only Ricotta's own page may ask.
    static func isAppOrigin(protocol scheme: String, host: String, port: Int) -> Bool {
        if let dev = devHome, scheme == dev.scheme, host == dev.host, port == (dev.port ?? 0) || (port == 0 && dev.port == nil) { return true }
        return scheme == "https" && host == live.host && (port == 0 || port == 443)
    }
    /// Links handed to the Mac's own apps: the browser, Mail, FaceTime and WhatsApp.
    static func isExternalLink(_ url: URL) -> Bool {
        ["https", "mailto", "tel", "whatsapp"].contains(url.scheme?.lowercased() ?? "")
    }
    static func isChallengeFrame(_ url: URL) -> Bool {
        ["about:blank", "about:srcdoc"].contains(url.absoluteString) ||
        (url.scheme == "https" && url.host == "challenges.cloudflare.com") || isAppPage(url)
    }
}
