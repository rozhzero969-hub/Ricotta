# Ricotta in Xcode

Open `Ricotta.xcodeproj`, choose the **Ricotta** scheme and an iPhone simulator, then press **Command–R** (Run).
Requires Xcode with the iOS SDK; deployment target is iOS 17 or later. No package installation is needed.

This is a small UIKit/WebKit shell around `https://rozhzero969-hub.github.io/Ricotta/`.
It uses the published app, including its normal PIN and Cloudflare check. Website releases appear here automatically.
Inside the app the page runs as an app frame (`window.RICOTTA_NATIVE_SHELL`): only the screen's content scrolls,
under its translucent top bar and floating tab bar, like a native iPhone app.
Local HTML/CSS/JavaScript edits are visible after they are published, not merely by building the iOS target.
There are no API secrets or database credentials in the native project.

## Included

- A launch screen in the loading screen's green (`LaunchBackground`), so the app opens without a white flash,
  and the Ricotta green as the app's accent colour (`AccentColor`).
- Persistent WebKit storage, with a separate sign-in from Safari.
- One message channel, `ricotta`, that accepts only fixed words from Ricotta's own page (main frame) and sends
  nothing back (see `sounds.js` `NATIVE_WORDS`): haptics (`selection`, `light`, `medium`, `success`, `warning`,
  `error`) and the page's look (`page-dark`, `page-light`), which sets the colour behind the page and
  the status bar text. A page that never reports its look gets the system colours after it loads.
- HTTPS-only in-app navigation restricted to Ricotta's repository path.
- Cloudflare challenge subframes with WebKit's default user agent.
- WhatsApp, telephone and email links handed to their installed apps.
- Native file sharing for downloadable exports.
- Native preview for order sheets/monthly reports. Tap **Print** in its toolbar to print or save a PDF through the system print workflow.
- Camera and microphone usage descriptions; capture is prompted only for Ricotta's main page.
- Apple's "content unavailable" screen when Ricotta can't be reached (and when the web process ends): a symbol,
  a title, one line of help, Try Again and Open in Safari.
- English, Kurdish (`ckb`) and Arabic for the app's own words (`Localizable.xcstrings`) and its camera and
  microphone questions (`InfoPlist.xcstrings`). The page has its own language setting.
- A privacy manifest (`PrivacyInfo.xcprivacy`: no tracking, the data the app collects for its own work) and
  `ITSAppUsesNonExemptEncryption = NO` (only standard HTTPS), so App Store Connect asks no export question.
- Web Inspector enabled in Debug builds only.

## Run on your own iPhone

1. Connect the iPhone to the Mac and select it as the run destination.
2. In **Ricotta → Signing & Capabilities**, choose your own Apple development team. The project deliberately contains no team ID or signing credentials.
3. Follow Xcode's device trust/Developer Mode instructions, then press **Command–R**.

## Current limits and verification

- Internet access is required; this shell does not bundle an offline copy of the website.
- Native APNs push notifications/background reminders are not implemented. The website/PWA remains the notification-capable option.
- This is a local development project, not an App Store submission or TestFlight release. For two people in one
  kitchen, Apple's own advice is TestFlight (internal testing needs no App Review), Ad Hoc, or a custom app through
  Apple Business Manager; a public App Store listing would also need a demo account for App Review (rule 2.1) and has
  to clear rule 4.2 (more than a repackaged website).
- The privacy policy is `privacy.html` on the site (linked in Settings and the account sheet); App Store Connect
  needs its address: `https://rozhzero969-hub.github.io/Ricotta/privacy.html`.
- Verified: Debug/Release simulator builds, URL-policy tests, installation/launch and live sign-in page rendering on an iPhone 18 Pro simulator.
- Still needs real-account/device checks: PIN/Cloudflare completion, authenticated orders, WhatsApp handoff, camera/microphone, PDF preview and file sharing. No live orders or business data were changed during setup.

Run the native navigation tests from the repository root:

```sh
xcrun swiftc ios/Ricotta/NavigationPolicy.swift ios/Tests/main.swift -o /tmp/ricotta-navigation-tests
/tmp/ricotta-navigation-tests
```

Native URL/permission handling lives in `Ricotta/NavigationPolicy.swift` and `Ricotta/RicottaViewController.swift`.
