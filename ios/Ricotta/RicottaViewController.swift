import UIKit
import WebKit

final class RicottaViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private var webView: WKWebView!
    private let popupConfiguration: WKWebViewConfiguration?
    init(popupConfiguration: WKWebViewConfiguration? = nil) {
        self.popupConfiguration = popupConfiguration
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("Use init(popupConfiguration:)") }
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let recovery = UIStackView()
    private let message = UILabel()
    private var downloadFiles: [ObjectIdentifier: URL] = [:]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let configuration = popupConfiguration ?? WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // Separate, persistent sign-in for this app.
        configuration.allowsInlineMediaPlayback = true
        if popupConfiguration == nil {
            // One read-only flag so the page can hide web-only hints (web push, Add to Home Screen).
            // It is not a bridge: the page cannot call back into the app.
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.RICOTTA_NATIVE_SHELL = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // Keep WebKit's default user agent and browser features for Cloudflare verification.
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
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
        view.addSubview(spinner)
        NSLayoutConstraint.activate([spinner.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                                     spinner.centerYAnchor.constraint(equalTo: view.centerYAnchor)])
        message.text = "Ricotta could not open. Check your connection, then try again."
        message.numberOfLines = 0
        message.textAlignment = .center
        message.font = .preferredFont(forTextStyle: .body)
        message.adjustsFontForContentSizeCategory = true
        let retry = UIButton(type: .system)
        retry.setTitle("Try again", for: .normal)
        retry.addTarget(self, action: #selector(loadHome), for: .touchUpInside)
        let safari = UIButton(type: .system)
        safari.setTitle("Open in Safari", for: .normal)
        safari.addTarget(self, action: #selector(openSafari), for: .touchUpInside)
        recovery.axis = .vertical
        recovery.spacing = 16
        [message, retry, safari].forEach(recovery.addArrangedSubview)
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
        if popupConfiguration == nil { loadHome() }
        else {
            title = "Order sheet"
            navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(closePreview))
            navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Print", style: .plain, target: self, action: #selector(printPreview))
        }
    }
    @objc private func closePreview() { dismiss(animated: true) }
    @objc private func printPreview() {
        let printer = UIPrintInteractionController.shared
        let information = UIPrintInfo(dictionary: nil)
        information.jobName = "Ricotta order sheet"
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

    @objc private func loadHome() {
        recovery.isHidden = true
        webView.isHidden = false
        spinner.startAnimating()
        webView.load(URLRequest(url: RicottaNavigation.home, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
    }
    @objc private func openSafari() { UIApplication.shared.open(RicottaNavigation.home) }
    private func failed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        spinner.stopAnimating()
        webView.isHidden = true
        recovery.isHidden = false
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { spinner.stopAnimating() }
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
        let alert = UIAlertController(title: "WhatsApp is not installed", message: "Open this message in your browser?", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Open", style: .default) { _ in UIApplication.shared.open(url) })
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
        let alert = UIAlertController(title: "Export could not finish", message: "Please try the export again.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
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
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Ricotta", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: "Ricotta", message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }
}
