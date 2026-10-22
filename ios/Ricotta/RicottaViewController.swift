import UIKit
import WebKit

final class RicottaViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let popupConfiguration: WKWebViewConfiguration?
    init(popupConfiguration: WKWebViewConfiguration? = nil) {
        self.popupConfiguration = popupConfiguration
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(popupConfiguration:)") }
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let recovery = UIStackView()
    private var downloadFiles: [ObjectIdentifier: URL] = [:]
    /// The app opens on the page's green loading screen, so it starts green with light status bar text;
    /// the page then reports whether it is light or dark (see `userContentController(_:didReceive:)`).
    private static let launchGreen = UIColor(named: "LaunchBackground") ?? UIColor(red: 0.078, green: 0.22, blue: 0.173, alpha: 1)
    private var statusBarStyle: UIStatusBarStyle = .lightContent
    private var pageReported = false
    private let selectionFeedback = UISelectionFeedbackGenerator()
    private let notificationFeedback = UINotificationFeedbackGenerator()
    override var preferredStatusBarStyle: UIStatusBarStyle { popupConfiguration == nil ? statusBarStyle : .default }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = popupConfiguration == nil ? Self.launchGreen : .systemBackground
        let configuration = popupConfiguration ?? WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // Separate, persistent sign-in for this app.
        configuration.allowsInlineMediaPlayback = true
        if popupConfiguration == nil {
            // One read-only flag so the page can hide web-only hints (web push, Add to Home Screen) and
            // run as an app frame.
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.RICOTTA_NATIVE_SHELL = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
            // The page may send a few fixed words (haptics and its light or dark look) and gets nothing back.
            configuration.userContentController.add(WeakMessageHandler(self), name: "ricotta")
        }
        // Keep WebKit's default user agent and browser features for Cloudflare verification.
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        // The app page uses viewport-fit=cover and pads itself with env(safe-area-inset-*), so it fills
        // the whole screen and paints its own background (and dark mode) behind the status bar.
        // The print preview sits under a navigation bar, so it stays inside the safe area.
        let fillsScreen = popupConfiguration == nil
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: fillsScreen ? view.topAnchor : view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: fillsScreen ? view.bottomAnchor : view.safeAreaLayoutGuide.bottomAnchor)
        ])
        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.hidesWhenStopped = true
        spinner.color = popupConfiguration == nil ? .white : nil
        view.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                                     spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        buildRecovery()
        if popupConfiguration == nil { loadHome() }
        else {
            title = String(localized: "Order Sheet")
            navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closePreview))
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: String(localized: "Print"), style: .plain, target: self, action: #selector(printPreview))
        }
    }
    /// When the app cannot reach Ricotta: Apple's "content unavailable" layout, with a symbol, a short
    /// title, one line of help, a filled Try Again button and Open in Safari.
    private func buildRecovery() {
        let symbol = UIImageView(image: UIImage(systemName: "wifi.exclamationmark",
                                                withConfiguration: UIImage.SymbolConfiguration(textStyle: .largeTitle, scale: .large)))
        symbol.tintColor = .secondaryLabel
        symbol.adjustsImageSizeForAccessibilityContentSizeCategory = true
        let title = UILabel()
        title.text = String(localized: "Can’t Open Ricotta")
        title.font = UIFont.preferredFont(forTextStyle: .title2).withTraits(.traitBold)
        title.adjustsFontForContentSizeCategory = true
        title.numberOfLines = 0
        title.textAlignment = .center
        let message = UILabel()
        message.text = String(localized: "Check your internet connection, then try again.")
        message.font = .preferredFont(forTextStyle: .body)
        message.textColor = .secondaryLabel
        message.adjustsFontForContentSizeCategory = true
        message.numberOfLines = 0
        message.textAlignment = .center
        var retryLook = UIButton.Configuration.filled()
        retryLook.title = String(localized: "Try Again")
        retryLook.cornerStyle = .capsule
        retryLook.buttonSize = .large
        let retry = UIButton(configuration: retryLook, primaryAction: UIAction { [weak self] _ in self?.loadHome() })
        var safariLook = UIButton.Configuration.plain()
        safariLook.title = String(localized: "Open in Safari")
        let safari = UIButton(configuration: safariLook, primaryAction: UIAction { _ in UIApplication.shared.open(RicottaNavigation.home) })
        recovery.axis = .vertical
        recovery.alignment = .center
        recovery.spacing = 10
        [symbol, title, message, retry, safari].forEach(recovery.addArrangedSubview)
        recovery.setCustomSpacing(16, after: symbol)
        recovery.setCustomSpacing(24, after: message)
        recovery.translatesAutoresizingMaskIntoConstraints = false
        recovery.isHidden = true
        view.addSubview(recovery)
        NSLayoutConstraint.activate([
            recovery.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            recovery.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            recovery.widthAnchor.constraint(lessThanOrEqualToConstant: 340),
            recovery.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 28),
            recovery.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -28)
        ])
    }
    private func setLook(background: UIColor, statusBar: UIStatusBarStyle) {
        view.backgroundColor = background
        statusBarStyle = statusBar
        setNeedsStatusBarAppearanceUpdate()
    }

    /// The only words the page can send (sounds.js `NATIVE_WORDS`); anything else, or anything from
    /// another page or frame, is ignored, and nothing is sent back.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url.map(RicottaNavigation.isAppPage) == true,
              let word = message.body as? String else { return }
        if word.hasPrefix("page-") { pageReported = true }
        switch word {
        case "selection": selectionFeedback.selectionChanged()
        case "light": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "success": notificationFeedback.notificationOccurred(.success)
        case "warning": notificationFeedback.notificationOccurred(.warning)
        case "error": notificationFeedback.notificationOccurred(.error)
        // The page's own background behind it, so nothing flashes when it resizes, and status bar
        // text that can be read on it.
        case "page-splash": setLook(background: Self.launchGreen, statusBar: .lightContent)
        case "page-dark": setLook(background: .black, statusBar: .lightContent)
        case "page-light": setLook(background: UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1), statusBar: .darkContent)
        default: break
        }
    }
    @objc private func closePreview() { dismiss(animated: true) }
    @objc private func printPreview() {
        let printer = UIPrintInteractionController.shared
        let information = UIPrintInfo(dictionary: nil)
        information.jobName = String(localized: "Ricotta Order Sheet")
        information.outputType = .general
        printer.printInfo = information
        printer.printFormatter = webView.viewPrintFormatter()
        if let button = navigationItem.rightBarButtonItem {
            printer.present(from: button, animated: true)
        } else {
            printer.present(animated: true)
        }
    }
    // Existing PDF/report actions write a printable document into a new about:blank window.
    // WebKit does not display window.print(); expose the native Print action on that preview.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard action.targetFrame == nil, action.request.url?.absoluteString == "about:blank",
              action.sourceFrame.isMainFrame, action.sourceFrame.request.url.map(RicottaNavigation.isAppPage) == true,
              presentedViewController == nil else { return nil }
        let preview = RicottaViewController(popupConfiguration: configuration)
        preview.loadViewIfNeeded()
        let navigation = UINavigationController(rootViewController: preview)
        present(navigation, animated: true)
        return preview.webView
    }
    func webViewDidClose(_ webView: WKWebView) {
        if popupConfiguration != nil { dismiss(animated: true) }
    }

    private func loadHome() {
        recovery.isHidden = true
        webView.isHidden = false
        pageReported = false
        setLook(background: Self.launchGreen, statusBar: .lightContent)
        spinner.startAnimating()
        webView.load(URLRequest(url: RicottaNavigation.home, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
    }
    private func failed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        spinner.stopAnimating()
        webView.isHidden = true
        recovery.isHidden = false
        setLook(background: .systemBackground, statusBar: .default)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimating()
        // A page that never reports its look (an older version of the site) gets the system's own colours.
        guard popupConfiguration == nil else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            guard let self, !self.pageReported, self.recovery.isHidden else { return }
            self.setLook(background: .systemBackground, statusBar: .default)
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        failed(NSError(domain: "Ricotta", code: 1))
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.absoluteString == "about:blank", popupConfiguration != nil ||
            (action.targetFrame == nil && action.sourceFrame.isMainFrame && action.sourceFrame.request.url.map(RicottaNavigation.isAppPage) == true) {
            decisionHandler(.allow)
            return
        }
        if action.targetFrame?.isMainFrame == false {
            // Turnstile uses HTTPS and sandboxed about: frames. Do not restrict ordinary subresources.
            decisionHandler(RicottaNavigation.isChallengeFrame(url) ? .allow : .cancel)
            return
        }
        let ownedBlob = RicottaNavigation.isAppBlob(url) && webView.url.map(RicottaNavigation.isAppPage) == true
        if action.shouldPerformDownload && (RicottaNavigation.isAppPage(url) || ownedBlob) {
            decisionHandler(.download)
        } else if RicottaNavigation.isAppPage(url) {
            if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
            else { decisionHandler(.allow) }
        } else if ownedBlob {
            decisionHandler(.download)
        } else {
            decisionHandler(.cancel)
            if RicottaNavigation.isExternalLink(url), action.navigationType == .linkActivated || action.targetFrame == nil {
                openExternal(url)
            }
        }
    }
    private func openExternal(_ url: URL) {
        UIApplication.shared.open(url, options: [:]) { [weak self] opened in
            guard !opened, url.scheme == "whatsapp" else { return }
            // WhatsApp may be missing in Simulator or on a new phone; preserve the composed message.
            var fallback = URLComponents(string: "https://wa.me/")!
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let phone = query.first(where: { $0.name == "phone" })?.value ?? ""
            fallback.path = "/" + phone.filter { $0.isNumber }
            fallback.queryItems = query.filter { $0.name == "text" }
            guard let fallbackURL = fallback.url else { return }
            DispatchQueue.main.async { self?.showExternalFallback(fallbackURL) }
        }
    }
    private func showExternalFallback(_ url: URL) {
        let alert = UIAlertController(title: String(localized: "WhatsApp Isn’t Installed"),
                                      message: String(localized: "Open this message in your browser?"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel))
        alert.addAction(UIAlertAction(title: String(localized: "Open"), style: .default) { _ in UIApplication.shared.open(url) })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let name = (suggestedFilename as NSString).lastPathComponent
            let file = folder.appendingPathComponent(name.isEmpty || name == "." || name == ".." ? "Ricotta-export" : name)
            downloadFiles[ObjectIdentifier(download)] = file
            completionHandler(file)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        share.popoverPresentationController?.sourceView = view
        share.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        share.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        present(share, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let alert = UIAlertController(title: String(localized: "Export Couldn’t Finish"),
                                      message: String(localized: "Please try the export again."), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default))
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == "https" && origin.host == RicottaNavigation.home.host &&
                        frame.isMainFrame && frame.request.url.map(RicottaNavigation.isAppPage) == true ? .prompt : .deny)
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Ricotta", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Ricotta", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "Ricotta", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: String(localized: "Cancel"), style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: String(localized: "OK"), style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }
}

/// WKUserContentController keeps its message handlers alive; this one passes messages on without
/// keeping the screen alive with them.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

private extension UIFont {
    func withTraits(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
        guard let descriptor = fontDescriptor.withSymbolicTraits(traits) else { return self }
        return UIFont(descriptor: descriptor, size: 0)
    }
}
