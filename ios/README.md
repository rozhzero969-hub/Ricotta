# Ricotta in Xcode

Open `Ricotta.xcodeproj`, choose the **Ricotta** scheme and an iPhone simulator, then press **Command–R** (Run).
Requires Xcode with the iOS SDK; deployment target is iOS 17 or later. No package installation is needed.

This is a small UIKit/WebKit shell around `https://rozhzero969-hub.github.io/Ricotta/`.
It uses the published app, including its normal PIN and Cloudflare check. Website releases appear here automatically.
Local HTML/CSS/JavaScript edits are visible after they are published, not merely by building the iOS target.
There are no API secrets or database credentials in the native project.

## Included

- Persistent WebKit storage, with a separate sign-in from Safari.
- HTTPS-only in-app navigation restricted to Ricotta's repository path.
- Cloudflare challenge subframes with WebKit's default user agent.
- WhatsApp, telephone and email links handed to their installed apps.
- Native file sharing for downloadable exports.
- Native preview for order sheets/monthly reports. Tap **Print** in its toolbar to print or save a PDF through the system print workflow.
- Camera and microphone usage descriptions; capture is prompted only for Ricotta's main page.
- A retry screen for navigation/network failure and a terminated web process.
- Web Inspector enabled in Debug builds only.

## Run on your own iPhone

1. Connect the iPhone to the Mac and select it as the run destination.
2. In **Ricotta → Signing & Capabilities**, choose your own Apple development team. The project deliberately contains no team ID or signing credentials.
3. Follow Xcode's device trust/Developer Mode instructions, then press **Command–R**.

## Current limits and verification

- Internet access is required; this shell does not bundle an offline copy of the website.
- Native APNs push notifications/background reminders are not implemented. The website/PWA remains the notification-capable option.
- This is a local development project, not an App Store submission or TestFlight release.
- Verified: Debug/Release simulator builds, URL-policy tests, installation/launch and live sign-in page rendering on an iPhone 18 Pro simulator.
- Still needs real-account/device checks: PIN/Cloudflare completion, authenticated orders, WhatsApp handoff, camera/microphone, PDF preview and file sharing. No live orders or business data were changed during setup.

Run the native navigation tests from the repository root:

```sh
xcrun swiftc ios/Ricotta/NavigationPolicy.swift ios/Tests/main.swift -o /tmp/ricotta-navigation-tests
/tmp/ricotta-navigation-tests
```

Native URL/permission handling lives in `Ricotta/NavigationPolicy.swift` and `Ricotta/RicottaViewController.swift`.
