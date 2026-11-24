import AppKit

/// Ricotta for Mac: one window around the published website (see MainWindowController), with the
/// Mac's standard menus. Closing the window keeps the app running, like Mail; the Dock icon or
/// File > New Window brings it back with the page as it was.
@main
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private var controller: MainWindowController?
    private var pendingWidget: String?
    private weak var seeThroughItem: NSMenuItem?

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Always See-Through starts off (it was on until 2026-11-20).
        UserDefaults.standard.register(defaults: [Preferences.seeThroughKey: false, Preferences.zoomKey: 1.0])
        Preferences.migrateSeeThroughDefault()
        NSApp.mainMenu = buildMenu()
        Preferences.applyAppIcon()
        let controller = MainWindowController()
        self.controller = controller
        if let view = pendingWidget { controller.openWidget(view); pendingWidget = nil }
        controller.showWindow(nil)
        NSApp.activate()
    }
    func application(_ application: NSApplication, open urls: [URL]) {
        guard let url = urls.first, url.scheme == "ricotta-mac", let target = url.host,
              ["order", "recipes", "assistant", "report"].contains(target) else { return }
        if let controller { controller.openWidget(target); NSApp.activate() }
        else { pendingWidget = target }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { controller?.showWindow(nil) }
        return true
    }
    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: Menu actions (the window's own actions are sent to MainWindowController through the responder chain)
    @objc func newWindow(_ sender: Any?) { controller?.showWindow(nil) }
    @objc func openSettings(_ sender: Any?) { controller?.showWindow(nil); controller?.send(.settings) }
    @objc func toggleSeeThrough(_ sender: Any?) { Preferences.seeThrough.toggle(); controller?.seeThroughChanged() }
    @objc func openInBrowser(_ sender: Any?) { NSWorkspace.shared.open(RicottaNavigation.live) }
    @objc func chooseAppIcon(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        controller?.setAppIcon(name)
    }
    @objc func chooseTheme(_ sender: NSMenuItem) {
        guard let name = sender.representedObject as? String else { return }
        controller?.setTheme(name)
    }

    @objc func toggleTouchID(_ sender: Any?) { controller?.toggleTouchID() }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(toggleTouchID(_:)) {
            menuItem.state = Preferences.useTouchID ? .on : .off
            return controller?.startupLocked == false
        }
        if menuItem.action == #selector(toggleSeeThrough(_:)) { menuItem.state = Preferences.seeThrough ? .on : .off }
        if menuItem.action == #selector(chooseAppIcon(_:)) { menuItem.state = menuItem.representedObject as? String == Preferences.appIcon ? .on : .off }
        if menuItem.action == #selector(chooseTheme(_:)) { menuItem.state = menuItem.representedObject as? String == Preferences.theme ? .on : .off }
        return true
    }

    // MARK: The menu bar
    private func buildMenu() -> NSMenu {
        let main = NSMenu()
        func submenu(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let menu = NSMenu(title: title)
            item.submenu = menu
            main.addItem(item)
            return menu
        }
        func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = .command, target: AnyObject? = nil) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            item.keyEquivalentModifierMask = modifiers
            item.target = target
            menu.addItem(item)
            return item
        }

        let app = submenu("Ricotta")
        _ = add(app, String(localized: "About Ricotta"), #selector(NSApplication.orderFrontStandardAboutPanel(_:)))
        app.addItem(.separator())
        _ = add(app, String(localized: "Settings…"), #selector(openSettings(_:)), ",", target: self)
        _ = add(app, String(localized: "Unlock with Touch ID"), #selector(toggleTouchID(_:)), target: self)
        app.addItem(.separator())
        let services = add(app, String(localized: "Services"), nil)
        services.submenu = NSMenu()
        NSApp.servicesMenu = services.submenu
        app.addItem(.separator())
        _ = add(app, String(localized: "Hide Ricotta"), #selector(NSApplication.hide(_:)), "h")
        _ = add(app, String(localized: "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option])
        _ = add(app, String(localized: "Show All"), #selector(NSApplication.unhideAllApplications(_:)))
        app.addItem(.separator())
        _ = add(app, String(localized: "Quit Ricotta"), #selector(NSApplication.terminate(_:)), "q")

        let file = submenu(String(localized: "File"))
        _ = add(file, String(localized: "New Window"), #selector(newWindow(_:)), "n", target: self)
        _ = add(file, String(localized: "Close Window"), #selector(NSWindow.performClose(_:)), "w")

        let edit = submenu(String(localized: "Edit"))
        _ = add(edit, String(localized: "Undo"), Selector(("undo:")), "z")
        _ = add(edit, String(localized: "Redo"), Selector(("redo:")), "z", [.command, .shift])
        edit.addItem(.separator())
        _ = add(edit, String(localized: "Cut"), #selector(NSText.cut(_:)), "x")
        _ = add(edit, String(localized: "Copy"), #selector(NSText.copy(_:)), "c")
        _ = add(edit, String(localized: "Paste"), #selector(NSText.paste(_:)), "v")
        _ = add(edit, String(localized: "Paste and Match Style"), #selector(NSTextView.pasteAsPlainText(_:)), "v", [.command, .option, .shift])
        _ = add(edit, String(localized: "Delete"), #selector(NSText.delete(_:)))
        _ = add(edit, String(localized: "Select All"), #selector(NSText.selectAll(_:)), "a")
        edit.addItem(.separator())
        _ = add(edit, String(localized: "Find"), #selector(MainWindowController.findInApp(_:)), "f")

        let view = submenu(String(localized: "View"))
        _ = add(view, String(localized: "Reload Page"), #selector(MainWindowController.reloadPage(_:)), "r")
        view.addItem(.separator())
        _ = add(view, String(localized: "Actual Size"), #selector(MainWindowController.actualSize(_:)), "0")
        _ = add(view, String(localized: "Zoom In"), #selector(MainWindowController.zoomIn(_:)), "+")
        // ⌘= is the same key as ⌘+ without Shift on most keyboards.
        let zoomInEquals = add(view, String(localized: "Zoom In"), #selector(MainWindowController.zoomIn(_:)), "=")
        zoomInEquals.isHidden = true
        zoomInEquals.allowsKeyEquivalentWhenHidden = true
        _ = add(view, String(localized: "Zoom Out"), #selector(MainWindowController.zoomOut(_:)), "-")
        view.addItem(.separator())
        seeThroughItem = add(view, String(localized: "Always See-Through"), #selector(toggleSeeThrough(_:)), "t", [.command, .option], target: self)
        let themes = add(view, String(localized: "Theme"), nil)
        themes.submenu = NSMenu(title: String(localized: "Theme"))
        for theme in AppTheme.allCases {
            let item = add(themes.submenu!, theme.title, #selector(chooseTheme(_:)), target: self)
            item.representedObject = theme.rawValue
            item.image = theme.swatch
        }
        let icons = add(view, String(localized: "App Icon"), nil)
        icons.submenu = NSMenu(title: String(localized: "App Icon"))
        for icon in AppIconChoice.allCases {
            let item = add(icons.submenu!, icon.title, #selector(chooseAppIcon(_:)), target: self)
            item.representedObject = icon.rawValue
            item.image = icon.preview(size: 18)
        }
        view.addItem(.separator())
        _ = add(view, String(localized: "Enter Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])

        let window = submenu(String(localized: "Window"))
        _ = add(window, String(localized: "Minimize"), #selector(NSWindow.performMiniaturize(_:)), "m")
        _ = add(window, String(localized: "Zoom"), #selector(NSWindow.performZoom(_:)))
        window.addItem(.separator())
        _ = add(window, String(localized: "Bring All to Front"), #selector(NSApplication.arrangeInFront(_:)))
        NSApp.windowsMenu = window

        let help = submenu(String(localized: "Help"))
        _ = add(help, String(localized: "Open Ricotta in Browser"), #selector(openInBrowser(_:)), target: self)
        NSApp.helpMenu = help
        return main
    }
}

/// The app's own choices, kept in UserDefaults.
enum Preferences {
    static var useTouchID: Bool {
        get { UserDefaults.standard.bool(forKey: "UnlockWithTouchID") }
        set { UserDefaults.standard.set(newValue, forKey: "UnlockWithTouchID") }
    }
    static let seeThroughKey = "AlwaysSeeThrough"
    static let zoomKey = "PageZoom"
    /// On: the page background and sidebar stay see-through. Off (the default): see-through only while loading.
    static var seeThrough: Bool {
        get { UserDefaults.standard.bool(forKey: seeThroughKey) }
        set { UserDefaults.standard.set(newValue, forKey: seeThroughKey) }
    }
    /// Once, when see-through became off by default: a saved "off" was someone's own choice and stays.
    /// A saved "on" can't be told apart from the old default (it was also saved while testing builds),
    /// so it goes back to the new default, off, one time only; turning it on again is kept from then on.
    static func migrateSeeThroughDefault() {
        let done = "SeeThroughOffByDefault"
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: done) else { return }
        if defaults.persistentDomain(forName: Bundle.main.bundleIdentifier ?? "")?[seeThroughKey] as? Bool == true {
            defaults.removeObject(forKey: seeThroughKey)
        }
        defaults.set(true, forKey: done)
    }
    static let appIconKey = "AppIcon"
    static let themeKey = "Theme"
    /// The Dock icon: one of AppIconChoice (anything else, such as a removed icon, reads as the default).
    static var appIcon: String {
        get { AppIconChoice(rawValue: UserDefaults.standard.string(forKey: appIconKey) ?? "")?.rawValue ?? AppIconChoice.ricotta.rawValue }
        set { UserDefaults.standard.set(AppIconChoice(rawValue: newValue)?.rawValue ?? AppIconChoice.ricotta.rawValue, forKey: appIconKey) }
    }
    /// The page's colours: one of AppTheme. A removed theme reads as Ricotta.
    static var theme: String {
        get {
            let saved = UserDefaults.standard.string(forKey: themeKey) ?? ""
            return AppTheme(rawValue: saved)?.rawValue ?? AppTheme.ricotta.rawValue
        }
        set { UserDefaults.standard.set(AppTheme(rawValue: newValue)?.rawValue ?? AppTheme.ricotta.rawValue, forKey: themeKey) }
    }
    /// Shown in the Dock (and the app switcher) while the app runs. The app bundle itself is never changed,
    /// since that would break its signature, so Finder and Launchpad keep the normal icon.
    static func applyAppIcon() {
        let choice = AppIconChoice(rawValue: appIcon) ?? .ricotta
        NSApp.applicationIconImage = choice.dockImage()
    }
    static var zoom: Double {
        get { min(max(UserDefaults.standard.double(forKey: zoomKey), 0.5), 3) }
        set { UserDefaults.standard.set(min(max(newValue, 0.5), 3), forKey: zoomKey) }
    }
}
