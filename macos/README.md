# Ricotta for Mac

A small AppKit/WebKit app around the published website, `https://rozhzero969-hub.github.io/Ricotta/`, for macOS 14 or later.
Website releases appear here automatically. There are no API secrets or database credentials in the project.

## Open, build and install

Open `RicottaMac.xcodeproj` in Xcode, choose the **Ricotta** scheme and **My Mac**, then press **Command-R**.

From Terminal (no paid developer account needed; the app is signed "ad hoc" so it runs on this Mac):

```sh
cd macos
xcodebuild -project RicottaMac.xcodeproj -scheme Ricotta -configuration Release -derivedDataPath ~/Library/Developer/RicottaMacBuild build
mkdir -p ~/Applications
rm -rf ~/Applications/Ricotta.app
cp -R ~/Library/Developer/RicottaMacBuild/Build/Products/Release/Ricotta.app ~/Applications/
open ~/Applications/Ricotta.app
```

Keep `-derivedDataPath` outside the repository (as above): build output must never be committed. `.gitignore` also
ignores `macos/build/`, `ios/build/`, `DerivedData/`, `xcuserdata/` and `*.xcuserstate`.

To build without any signing, add `CODE_SIGNING_ALLOWED=NO` (the app then runs without its sandbox).

### First run on another Mac

An ad hoc signed app copied to another Mac (by AirDrop, a USB stick or a download) is stopped by Gatekeeper the
first time. In Finder, **right-click Ricotta > Open**, then click **Open** in the dialog. On recent macOS versions,
if there is no Open button: try to open it once, then go to **System Settings > Privacy & Security** and click
**Open Anyway**. This is needed only once. A build made on the same Mac opens normally.

## What it does

- **See-through window.** The window's background is the Mac's blurred window material (`NSVisualEffectView`,
  behind-window blending), and the page is drawn with a transparent background. While the page loads, the window is
  see-through with the Ricotta icon in the middle.
- **Always See-Through** (View menu, Option-Command-T, and in Ricotta's Settings > Look). Off by default: see-through
  only while loading, then solid like the website. On: the page background and the sidebar stay see-through; cards,
  lists, sheets and buttons stay solid. Only the person's own choice is ever saved, so a choice made before the default
  changed is kept.
- **Theme**: Ricotta, Shayda Cosmetic, or Shayda Beauty. These choices stay on the Mac. Each has a native loading animation that respects Reduce Motion. The browser and phone always use the standard Ricotta appearance.
- **App icon**: the default Ricotta icon or one of nine supplied choices grouped into Cosmetic, Beauty, and Ricotta. The choice affects the running app’s Dock icon.
- **Desktop widget**: choose **Ricotta shortcuts** in the macOS widget gallery. The small widget opens Orders; the medium widget links to Orders, Recipes, and Rico. The shortcuts still require the app’s normal sign-in and permissions.
- **Touch ID**: after signing in with your PIN, enable **Ricotta → Unlock with Touch ID**. On launch the app checks your fingerprint through macOS before opening the site. **Use PIN** clears this Mac app’s saved session before opening the sign-in page. Ricotta never stores the PIN or fingerprint, and Touch ID does not extend the server session.
- **Rico notifications**: open **Rico → Scheduled → Turn on notifications** and allow alerts in macOS. The custom chime and banners work while Ricotta is running and signed in, including when its window is closed. When Ricotta is quit, use a device with web push enabled. macOS Focus and notification preferences still apply.

- **Notifications.** Web push does not work inside a WKWebView app on macOS (`PushManager` is not available to the
  page), and native push would need Apple's push service with a paid developer account. The website in Safari or
  Chrome (or the Home Screen app on iPhone) stays the way to get Ricotta's notifications.
- No App Store or notarised build: there is no paid developer account.

## Testing against a local Lab

Debug builds only: point the app at a local Ricotta Lab before a website change is live. Release builds always load the
live site.

```sh
sh lab/build.sh
python3 -m http.server 8765 --directory lab/dist
xcodebuild -project macos/RicottaMac.xcodeproj -scheme Ricotta -configuration Debug -derivedDataPath ~/Library/Developer/RicottaMacBuild build
open ~/Library/Developer/RicottaMacBuild/Build/Products/Debug/Ricotta.app --args -RicottaDevURL http://127.0.0.1:8765/
```

Only `localhost` and `127.0.0.1` are accepted. Web Inspector is on in Debug builds only.

Navigation, theme and icon tests, from the repository root:

```sh
xcrun swiftc macos/Ricotta/NavigationPolicy.swift macos/Ricotta/Choices.swift macos/Tests/theme-icon-tests.swift macos/Tests/main.swift -o /tmp/ricotta-mac-navigation-tests
/tmp/ricotta-mac-navigation-tests
```
