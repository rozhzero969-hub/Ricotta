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
- **Theme** (View > Theme and Settings > Look): Ricotta Verde, Pumpkin Hour, Winter Holly, Moonlit Pantry,
  Apricot Coast and Cupid’s Kitchen. Each includes light and dark palettes, artwork and a control style.
  The five alternate themes also give Rico and the kitchen streak a matching symbol. The theme applies
  before the page paints. Theme changes cross-fade for 220 ms when Reduce Motion is off.
- **App icon** (View > App Icon and Settings > Look): Basil Leaf, Jack & Moon, Holly Bauble, Lunar Orbit,
  Sunny Side and Bow Bear. Selecting a theme offers its matching icon in Settings. The selected icon appears
  in the Dock and app switcher while Ricotta runs. Finder and Launchpad use the signed app bundle’s icon.
  Removed Dock icon preferences fall back to Basil Leaf.

### The page and the app talk only in fixed words

- The app sets read-only flags before the page runs: `RICOTTA_NATIVE_SHELL`, `RICOTTA_MAC_SHELL`, `RICOTTA_SEE_THROUGH`,
  `RICOTTA_THEME`, `RICOTTA_APP_ICON`. `boot.js` then marks `html.mac-shell`, `html.see-through` and `html.theme-<name>`.
  Browsers, phones and the iPhone app never set them, so nothing changes there.
- The page sends fixed words on the `ricotta` channel (`sounds.js` `NATIVE_WORDS`): `see-through-on`, `see-through-off`,
  `theme:<name>`, `icon:<name>`, `window-drag`, `window-zoom`, and the look words the iPhone app also uses. The app accepts
  them only from Ricotta's main frame, and only known theme and icon names.
- The app sends fixed words back as a `ricotta-mac` event: `settings`, `find`, `see-through-on/off`, `full-screen-on/off`,
  `theme:<name>`, `icon:<name>`.

## App icons: where they live and how to swap one

- `IconSources/<name>.svg`: the drawing, 1024 x 1024 on Apple's macOS icon grid (an 824 pt squircle with its shadow).
- `IconSources/<name>.png` (optional): a finished 1024 x 1024 PNG, for example one made elsewhere. When it is there it
  is used instead of the SVG. Keep the transparent margin and the squircle shape so it lines up with the others.
- `node macos/IconSources/render-icons.cjs` (from the repository root, after `pnpm install`) writes every size:
  `Ricotta/Assets.xcassets/AppIcon-<name>.imageset/` (512 and 1024 px) and the website's `mac-icons/<name>.png`
  (96 px, the Settings picker). Add `--sheet out.png` to see all of them at 16, 32, 128 and 256 pt.
- Icon names are shared by `AppIconChoice` (`Choices.swift`), `MAC_ICONS` (`sounds.js`), `ICONS`
  (`render-icons.cjs`), and the localized names in `i18n.js` and `Localizable.xcstrings`.
- Hero and theme picker artwork lives in `mac-icons/*-art.svg`. The small streak and Rico silhouettes
  live in `style.css`.

## Not included

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
