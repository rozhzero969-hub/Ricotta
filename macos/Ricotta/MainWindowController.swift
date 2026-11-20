import AppKit
import WebKit

/// Fixed words the app sends to the page (as a `ricotta-mac` event; app.js listens only inside the Mac app).
enum PageCommand: String {
    case settings, find
    case seeThroughOn = "see-through-on", seeThroughOff = "see-through-off"
    case fullScreenOn = "full-screen-on", fullScreenOff = "full-screen-off"
}

/// The one window: the Mac's blurred window material (the desktop shows through it), Ricotta's page on
/// top with a transparent background, a see-through loading screen with the Ricotta logo while the page
/// loads, and Apple's "content unavailable" screen when Ricotta can't be reached.
final class MainWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    private let material = NSVisualEffectView()
    private var webView: RicottaWebView!
    private let loading = LoadingView()
    private let offline = OfflineView()
    private var isLoading = false
    private var loadGeneration = 0
    private var downloadFiles: [ObjectIdentifier: URL] = [:]

    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "Ricotta"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        // An empty toolbar makes the title bar as tall as a Mac sidebar app's, so the traffic lights sit
        // inset, inside the top of Ricotta's sidebar (the page leaves room for them, see style.css).
        let toolbar = NSToolbar(identifier: "Ricotta")
        toolbar.displayMode = .iconOnly
        toolbar.allowsUserCustomization = false
        window.toolbar = toolbar
        window.toolbarStyle = .unified
        window.isOpaque = false
        window.backgroundColor = .clear
        window.minSize = NSSize(width: 640, height: 480)
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenPrimary)
        super.init(window: window)
        self.toolbar = toolbar
        window.delegate = self
        // Size and position are remembered between launches.
        window.setFrameAutosaveName("RicottaMainWindow")
        if !window.setFrameUsingName("RicottaMainWindow") { window.center() }
        buildContent()
        loadHome()
    }
    required init?(coder: NSCoder) { fatalError("Use init()") }

    private func buildContent() {
        guard let window else { return }
        let root = NSView()
        window.contentView = root

        // The desktop shows through, blurred, behind the whole window (also while loading).
        material.material = .sidebar
        material.blendingMode = .behindWindow
        material.state = .active
        pin(material, in: root)

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default() // Persistent, and a sign-in separate from Safari.
        configuration.userContentController.add(WeakMessageHandler(self), name: "ricotta")
        configuration.preferences.isElementFullscreenEnabled = true
        installFlags(configuration.userContentController)
        webView = RicottaWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsMagnification = false
        webView.setValue(false, forKey: "drawsBackground") // the page's own transparent background shows the material
        webView.underPageBackgroundColor = .clear
        webView.pageZoom = Preferences.zoom
        #if DEBUG
        webView.isInspectable = true
        #endif
        pin(webView, in: root)

        pin(loading, in: root)
        pin(offline, in: root)
        offline.isHidden = true
        offline.onRetry = { [weak self] in self?.loadHome() }
        offline.onOpenInBrowser = { NSWorkspace.shared.open(RicottaNavigation.live) }
    }
    private func pin(_ view: NSView, in root: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(view)
        NSLayoutConstraint.activate([view.leadingAnchor.constraint(equalTo: root.leadingAnchor), view.trailingAnchor.constraint(equalTo: root.trailingAnchor),
                                     view.topAnchor.constraint(equalTo: root.topAnchor), view.bottomAnchor.constraint(equalTo: root.bottomAnchor)])
    }

    /// Read-only flags for the page, set before it runs: it is inside the Mac app (boot.js marks
    /// `html.mac-shell`) and whether "Always See-Through" is on (`html.see-through`).
    private func installFlags(_ controller: WKUserContentController) {
        controller.removeAllUserScripts()
        // Only known names reach the page (Preferences reads anything else as the default).
        let source = "window.RICOTTA_NATIVE_SHELL = true; window.RICOTTA_MAC_SHELL = true; window.RICOTTA_SEE_THROUGH = \(Preferences.seeThrough ? "true" : "false"); " +
            "window.RICOTTA_APP_ICON = '\(Preferences.appIcon)'; window.RICOTTA_THEME = '\(Preferences.theme)';"
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /// Sends one fixed word to Ricotta's page. Nothing else is ever run in the page.
    func send(_ command: PageCommand) { dispatch(command.rawValue) }
    private func dispatch(_ word: String) {
        guard let url = webView.url, RicottaNavigation.isAppPage(url) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('ricotta-mac', {detail: '\(word)'}))")
    }
    /// The Dock icon, from the View menu or Ricotta's Settings; only known names are accepted.
    func setAppIcon(_ name: String) {
        guard let choice = AppIconChoice(rawValue: name) else { return }
        Preferences.appIcon = choice.rawValue
        Preferences.applyAppIcon()
        installFlags(webView.configuration.userContentController)
        dispatch("icon:" + choice.rawValue)
    }
    /// The page's colour theme, from the View menu or Ricotta's Settings; only known names are accepted.
    func setTheme(_ name: String) {
        guard let theme = AppTheme(rawValue: name) else { return }
        Preferences.theme = theme.rawValue
        installFlags(webView.configuration.userContentController)
        dispatch("theme:" + theme.rawValue)
    }
    func seeThroughChanged() {
        installFlags(webView.configuration.userContentController) // for the next load
        send(Preferences.seeThrough ? .seeThroughOn : .seeThroughOff)
    }

    // MARK: Loading
    private func loadHome() {
        startLoading()
        webView.load(URLRequest(url: RicottaNavigation.home, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
    }
    private func startLoading() {
        loadGeneration += 1
        isLoading = true
        offline.isHidden = true
        webView.isHidden = false
        webView.alphaValue = 0 // kept in the window (not hidden) so the page runs and lays out normally
        loading.alphaValue = 1
        loading.isHidden = false
        loading.start()
    }
    /// The page has finished its own loading screen: fade it in over the see-through window.
    private func reveal() {
        guard isLoading else { return }
        isLoading = false
        NSAnimationContext.runAnimationGroup({ context in
            // Apple's ease-out: quick to appear, settling softly; a plain cut with Reduce Motion.
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.26
            context.timingFunction = CAMediaTimingFunction(controlPoints: 0.23, 1, 0.32, 1)
            webView.animator().alphaValue = 1
            loading.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, !self.isLoading else { return }
            self.loading.isHidden = true
            self.loading.stop()
        })
    }
    private func failed(_ error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        isLoading = false
        loading.isHidden = true
        loading.stop()
        webView.isHidden = true
        offline.isHidden = false
        setLook(nil)
    }
    private func setLook(_ appearance: NSAppearance?) {
        // Only the material and the app's own screens follow the page; the page itself keeps following
        // the Mac's light or dark setting (or its own choice in Settings).
        material.appearance = appearance
        loading.appearance = appearance
        offline.appearance = appearance
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // A page that never says its loading screen has lifted (an older version of the site) is shown anyway.
        let generation = loadGeneration
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self, self.loadGeneration == generation else { return }
            self.reveal()
        }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { failed(NSError(domain: "Ricotta", code: 1)) }

    // MARK: Words from the page
    /// The only words the page can send (sounds.js `NATIVE_WORDS`); anything else, or anything from
    /// another page or frame, is ignored.
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url.map(RicottaNavigation.isAppPage) == true,
              let word = message.body as? String else { return }
        switch word {
        case "page-splash": setLook(nil)
        case "page-dark", "page-light":
            setLook(NSAppearance(named: word == "page-dark" ? .darkAqua : .aqua))
            if isFullScreen { send(.fullScreenOn) } // a page loaded in full screen starts without the mark
            reveal()
        case "see-through-on", "see-through-off":
            Preferences.seeThrough = word == "see-through-on"
            seeThroughChanged()
        case "window-drag":
            // A press on an empty part of the top bar or sidebar moves the window, like a title bar.
            if NSEvent.pressedMouseButtons & 1 == 1, let event = webView.lastMouseDown { window?.performDrag(with: event) }
        case "window-zoom": titleBarDoubleClick()
        case _ where word.hasPrefix("icon:"): setAppIcon(String(word.dropFirst(5)))
        case _ where word.hasPrefix("theme:"): setTheme(String(word.dropFirst(6)))
        default: break // haptics and other iPhone words
        }
    }
    /// What a double-click on a title bar does, as chosen in System Settings > Desktop & Dock.
    private func titleBarDoubleClick() {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") {
        case "Minimize": window?.performMiniaturize(nil)
        case "None": break
        default: window?.performZoom(nil)
        }
    }

    // MARK: Menu actions
    @objc func reloadPage(_ sender: Any?) {
        if offline.isHidden == false || webView.url == nil { loadHome(); return }
        startLoading()
        webView.reload()
    }
    @objc func findInApp(_ sender: Any?) { send(.find) }
    @objc func actualSize(_ sender: Any?) { setZoom(1) }
    @objc func zoomIn(_ sender: Any?) { setZoom(webView.pageZoom + 0.1) }
    @objc func zoomOut(_ sender: Any?) { setZoom(webView.pageZoom - 0.1) }
    private func setZoom(_ value: Double) {
        Preferences.zoom = (value * 10).rounded() / 10
        webView.pageZoom = Preferences.zoom
    }

    // MARK: Window
    /// In full screen AppKit moves a window's toolbar into its own strip under the menu bar, and that strip
    /// stays over the top of the page (the profile, Rico and the streak). The toolbar is only there to place
    /// the window buttons inside the sidebar, so full screen goes without it: the page fills the screen and
    /// the window buttons slide down with the menu bar like in other Mac apps. It is back before the window
    /// leaves full screen.
    private var toolbar: NSToolbar?
    private var isFullScreen: Bool { window?.styleMask.contains(.fullScreen) == true }
    func windowWillEnterFullScreen(_ notification: Notification) {
        window?.toolbar = nil
        send(.fullScreenOn) // the page drops the room it keeps for the window buttons
    }
    func windowDidFailToEnterFullScreen(_ window: NSWindow) { leftFullScreen() }
    func windowWillExitFullScreen(_ notification: Notification) { leftFullScreen() }
    func windowDidExitFullScreen(_ notification: Notification) { leftFullScreen() }
    private func leftFullScreen() {
        if window?.toolbar == nil, let toolbar { window?.toolbar = toolbar }
        send(.fullScreenOff)
    }

    // MARK: Navigation (the same rules as the iPhone app)
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false {
            // Turnstile uses HTTPS and sandboxed about: frames. Ordinary subresources are not restricted.
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
            // WhatsApp, phone, mail, Ricotta Restaurant and other sites open in the Mac's own apps.
            if RicottaNavigation.isExternalLink(url), action.navigationType == .linkActivated || action.targetFrame == nil {
                NSWorkspace.shared.open(url)
            }
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping @MainActor (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    // MARK: Downloads: exports go to Downloads and are shown in Finder
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping @MainActor (URL?) -> Void) {
        let file = Self.downloadDestination(for: suggestedFilename)
        downloadFiles[ObjectIdentifier(download)] = file
        completionHandler(file)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // The Downloads stack in the Dock bounces, and Finder shows the file.
        DistributedNotificationCenter.default().post(name: Notification.Name("com.apple.DownloadFileFinished"), object: file.resolvingSymlinksInPath().path)
        NSWorkspace.shared.activateFileViewerSelecting([file.resolvingSymlinksInPath()])
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let file = downloadFiles.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: file) }
        showAlert(String(localized: "Export Couldn’t Finish"), String(localized: "Please try the export again."))
    }
    /// ~/Downloads/<name>, numbered like Safari does when a file with that name is already there.
    static func downloadDestination(for suggested: String) -> URL {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        var name = (suggested as NSString).lastPathComponent.replacingOccurrences(of: ":", with: "-")
        if name.isEmpty || name == "." || name == ".." || name.hasPrefix(".") { name = "Ricotta export" }
        let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
        var candidate = folder.appendingPathComponent(name)
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            candidate = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return candidate
    }

    // MARK: Files, camera and microphone, dialogs
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping @MainActor ([URL]?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping @MainActor (WKPermissionDecision) -> Void) {
        let own = RicottaNavigation.isAppOrigin(protocol: origin.protocol, host: origin.host, port: origin.port) &&
            frame.isMainFrame && frame.request.url.map(RicottaNavigation.isAppPage) == true
        decisionHandler(own ? .prompt : .deny)
    }
    /// The page never opens extra windows; a link meant for one is handled in decidePolicyFor above.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, !RicottaNavigation.isAppPage(url), RicottaNavigation.isExternalLink(url) {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor () -> Void) {
        let alert = NSAlert()
        alert.messageText = "Ricotta"
        alert.informativeText = message
        alert.addButton(withTitle: String(localized: "OK"))
        present(alert) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Ricotta"
        alert.informativeText = message
        alert.addButton(withTitle: String(localized: "OK"))
        alert.addButton(withTitle: String(localized: "Cancel"))
        present(alert) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = "Ricotta"
        alert.informativeText = prompt
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: String(localized: "OK"))
        alert.addButton(withTitle: String(localized: "Cancel"))
        present(alert) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
    }
    private func showAlert(_ title: String, _ message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: String(localized: "OK"))
        present(alert) { _ in }
    }
    private func present(_ alert: NSAlert, _ done: @escaping (NSApplication.ModalResponse) -> Void) {
        if let window, window.isVisible { alert.beginSheetModal(for: window, completionHandler: done) }
        else { done(alert.runModal()) }
    }
}

/// The web view: no Reload, Back or Inspect Element in its right-click menu (copy, paste, look up and
/// spelling stay), and it remembers the last mouse press so the page can start a window move.
final class RicottaWebView: WKWebView {
    private(set) var lastMouseDown: NSEvent?
    override func mouseDown(with event: NSEvent) {
        lastMouseDown = event
        super.mouseDown(with: event)
    }
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu, with: event)
        var removed: Set<String> = ["WKMenuItemIdentifierReload", "WKMenuItemIdentifierGoBack", "WKMenuItemIdentifierGoForward",
                                    "WKMenuItemIdentifierOpenLinkInNewWindow", "WKMenuItemIdentifierDownloadLinkedFile",
                                    "WKMenuItemIdentifierOpenImageInNewWindow", "WKMenuItemIdentifierDownloadImage",
                                    "WKMenuItemIdentifierOpenFrameInNewWindow", "WKMenuItemIdentifierOpenMediaInNewWindow",
                                    "WKMenuItemIdentifierDownloadMedia", "WKMenuItemIdentifierShowHideMediaControls",
                                    "WKMenuItemIdentifierToggleEnhancedFullScreen", "WKMenuItemIdentifierToggleFullScreen",
                                    "WKMenuItemIdentifierShareMenu"]
        #if !DEBUG
        removed.insert("WKMenuItemIdentifierInspectElement")
        #endif
        for item in menu.items where removed.contains(item.identifier?.rawValue ?? "") { menu.removeItem(item) }
        // No separator left at the start or end, or two in a row.
        while menu.items.first?.isSeparatorItem == true { menu.removeItem(at: 0) }
        while menu.items.last?.isSeparatorItem == true { menu.removeItem(at: menu.items.count - 1) }
        var index = menu.items.count - 1
        while index > 0 {
            if menu.items[index].isSeparatorItem && menu.items[index - 1].isSeparatorItem { menu.removeItem(at: index) }
            index -= 1
        }
    }
}

/// WKUserContentController keeps its message handlers alive; this one passes messages on without
/// keeping the window alive with them.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
