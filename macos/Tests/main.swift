import Foundation

func expect(_ condition: @autoclosure () -> Bool, _ label: String) {
    guard condition() else { fatalError("Failed: \(label)") }
}
for value in ["https://rozhzero969-hub.github.io/Ricotta/", "https://rozhzero969-hub.github.io/Ricotta/?n=note", "https://rozhzero969-hub.github.io/Ricotta", "https://rozhzero969-hub.github.io/Ricotta/index.html"] {
    expect(RicottaNavigation.isAppPage(URL(string: value)!), "own page \(value)")
}
for value in ["http://rozhzero969-hub.github.io/Ricotta/", "https://rozhzero969-hub.github.io/Ricotta-evil/", "https://rozhzero969-hub.github.io/another-app/", "https://rozhzero969-hub.github.io.evil.example/Ricotta/", "https://evil.example/Ricotta/", "https://rozhzero969-hub.github.io/Ricotta/%2e%2e/another-app/", "file:///Ricotta/index.html", "javascript:alert(1)", "https://user:pass@rozhzero969-hub.github.io/Ricotta/", "https://rozhzero969-hub.github.io:8443/Ricotta/"] {
    expect(!RicottaNavigation.isAppPage(URL(string: value)!), "reject page \(value)")
}
expect(RicottaNavigation.isAppBlob(URL(string: "blob:https://rozhzero969-hub.github.io/123")!), "owned export")
expect(!RicottaNavigation.isAppBlob(URL(string: "blob:https://evil.example/123")!), "foreign blob")
expect(!RicottaNavigation.isExternalLink(URL(string: "file:///etc/passwd")!), "no local-file handoff")
expect(!RicottaNavigation.isExternalLink(URL(string: "javascript:alert(1)")!), "no script handoff")
expect(RicottaNavigation.isExternalLink(URL(string: "whatsapp://send?phone=123&text=test")!), "WhatsApp handoff")
expect(RicottaNavigation.isChallengeFrame(URL(string: "https://challenges.cloudflare.com/turnstile/v0/test")!), "challenge frame")
expect(RicottaNavigation.isChallengeFrame(URL(string: "about:blank")!), "blank challenge frame")
expect(RicottaNavigation.isChallengeFrame(URL(string: "about:srcdoc")!), "sandbox challenge frame")
expect(!RicottaNavigation.isChallengeFrame(URL(string: "https://evil.example")!), "foreign frame")
expect(RicottaNavigation.devHome == nil, "release-style run has no local override")
expect(RicottaNavigation.isAppOrigin(protocol: "https", host: "rozhzero969-hub.github.io", port: 0), "own origin may ask for the camera")
expect(!RicottaNavigation.isAppOrigin(protocol: "https", host: "evil.example", port: 0), "other origins may not")
expect(!RicottaNavigation.isAppOrigin(protocol: "http", host: "rozhzero969-hub.github.io", port: 0), "plain http may not")
expect(!RicottaNavigation.isAppPage(URL(string: "http://127.0.0.1:8765/")!), "no local Lab without the debug override")
print("PASS (Mac): Ricotta page boundaries, external schemes, export origins and Cloudflare frames")
