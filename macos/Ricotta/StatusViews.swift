import AppKit

/// While the page loads: nothing but the window's blurred see-through background and the Ricotta logo
/// in the middle, breathing gently, with a small spinner below it.
final class LoadingView: NSView {
    private let logo = NSImageView()
    private let spinner = NSProgressIndicator()

    override init(frame: NSRect) {
        super.init(frame: frame)
        logo.image = NSImage(named: "LoadingLogo") ?? NSApp.applicationIconImage
        logo.imageScaling = .scaleProportionallyUpOrDown
        logo.wantsLayer = true
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.setAccessibilityLabel("Ricotta")
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.translatesAutoresizingMaskIntoConstraints = false
        addSubview(logo)
        addSubview(spinner)
        NSLayoutConstraint.activate([
            logo.centerXAnchor.constraint(equalTo: centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -12),
            logo.widthAnchor.constraint(equalToConstant: 96),
            logo.heightAnchor.constraint(equalToConstant: 96),
            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.topAnchor.constraint(equalTo: logo.bottomAnchor, constant: 28)
        ])
    }
    required init?(coder: NSCoder) { fatalError("Use init(frame:)") }

    func start() {
        spinner.startAnimation(nil)
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, let layer = logo.layer else { return }
        let breathe = CABasicAnimation(keyPath: "opacity")
        breathe.fromValue = 1
        breathe.toValue = 0.72
        breathe.duration = 1.1
        breathe.autoreverses = true
        breathe.repeatCount = .infinity
        breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(breathe, forKey: "breathe")
    }
    func stop() {
        spinner.stopAnimation(nil)
        logo.layer?.removeAllAnimations()
    }
}

/// When Ricotta can't be reached: Apple's "content unavailable" layout, with a symbol, a short title,
/// one line of help, Try Again and Open in Browser. The page's own offline mode covers the time after it
/// has loaded once; this is for when it can't load at all.
final class OfflineView: NSView {
    var onRetry: (() -> Void)?
    var onOpenInBrowser: (() -> Void)?

    override init(frame: NSRect) {
        super.init(frame: frame)
        let symbol = NSImageView(image: NSImage(systemSymbolName: "wifi.exclamationmark", accessibilityDescription: nil) ?? NSImage())
        symbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 44, weight: .regular)
        symbol.contentTintColor = .secondaryLabelColor
        let title = NSTextField(labelWithString: String(localized: "Can’t Open Ricotta"))
        title.font = .systemFont(ofSize: 22, weight: .bold)
        title.alignment = .center
        let message = NSTextField(wrappingLabelWithString: String(localized: "Check your internet connection, then try again."))
        message.font = .systemFont(ofSize: 13)
        message.textColor = .secondaryLabelColor
        message.alignment = .center
        message.preferredMaxLayoutWidth = 320
        let retry = NSButton(title: String(localized: "Try Again"), target: self, action: #selector(retryPressed))
        retry.bezelStyle = .push
        retry.controlSize = .large
        retry.keyEquivalent = "\r"
        let browser = NSButton(title: String(localized: "Open in Browser"), target: self, action: #selector(browserPressed))
        browser.isBordered = false
        browser.contentTintColor = .controlAccentColor
        let stack = NSStackView(views: [symbol, title, message, retry, browser])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 8
        stack.setCustomSpacing(16, after: symbol)
        stack.setCustomSpacing(22, after: message)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 360)
        ])
    }
    required init?(coder: NSCoder) { fatalError("Use init(frame:)") }
    @objc private func retryPressed() { onRetry?() }
    @objc private func browserPressed() { onOpenInBrowser?() }
}
