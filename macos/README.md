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
- **Theme** (View > Theme and Settings > Look): Ricotta (default), Halloween, Christmas, Discord, Google, Pink. It
  changes the accent colour (buttons, chosen tab, switches, links), the Order card, the page background and the
  see-through tint, in light and dark, with AA text contrast (`style.css`, "Colour themes"). Colour palettes only: no
  logos or brand marks. Pink also draws a small bow on the Order card and beside the logo, a thin cupid's arrow under
  page titles and, when see-through, a faint scatter of hearts (CSS variables `--pk-bow`, `--pk-arrow`, `--pk-scatter`
  in `style.css`; wide windows only, `pointer-events:none`). Changing theme cross-fades for 220 ms (none with Reduce
  Motion). Applied before the page paints.
- **App icon** (View > App Icon and Settings > Look), in two groups. With the themes: `green` (Ricotta, the app's own
  icon), `halloween`, `christmas`, `discord`, `google`, `pink`. More: `cream`, `forest`, `wordmark`, `slip` (order
  slip), `wedge` (cheese), `bag`, `glass`, `dark`. Choosing a theme offers its matching icon with a button in Settings;
  it never changes the icon by itself. The icon is shown in the Dock and the app switcher while Ricotta runs
  (`NSApp.applicationIconImage`). The app bundle is never changed (that would break its signature), so Finder and
  Launchpad always show the normal green icon.
- A hidden title bar with the window buttons inside the top of Ricotta's sidebar; size and position are remembered.
  An empty part of the top bar or sidebar moves the window, and a double-click zooms it.
  In full screen the window has no toolbar strip, so the whole page shows; the window buttons slide down with the
  menu bar, and the page drops the room it keeps for them (`full-screen-on/off`, also re-sent after a reload).
- Standard menus: Command-R reload, Command-W close (the app keeps running; the Dock icon or Command-N brings the window
  back), Command-Q quit, Command-comma opens Ricotta's Settings, Command-F focuses the screen's search (or opens search),
  copy and paste, Command-plus / Command-minus / Command-0 for page zoom, full screen.
- WhatsApp, phone, mail, Ricotta Restaurant and other sites open in the Mac's own apps or browser. In-app navigation is
  limited to Ricotta's HTTPS pages, as in the iPhone app.
- PDF and Excel exports are saved to Downloads and shown in Finder. File and photo pickers use the Mac's open panel.
  Camera and microphone are offered only to Ricotta's own page.
- A "Can't Open Ricotta" screen when the site can't be reached at all. Once loaded, the website's own offline mode works
  (its service worker runs in the app).
- Persistent storage, with a sign-in separate from Safari. No Reload, Back or Inspect Element in the right-click menu,
  and no back/forward swipe.
- English, Kurdish (`ckb`) and Arabic for the app's own words (`Localizable.xcstrings`, `InfoPlist.xcstrings`).

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
- A new icon name also goes in `AppIconChoice` (`AppDelegate.swift`), `MAC_ICONS` (`sounds.js`), `ICONS`
  (`render-icons.cjs`), the `macIcon_<name>` text in `i18n.js` and its title in `Localizable.xcstrings`.
- The Pink theme's bow, arrow and hearts are SVGs inside `style.css` (`--pk-bow`, `--pk-arrow`, `--pk-scatter`). To use
  pictures instead, point those variables at image files next to `style.css` (and add them to `scripts/build-site.cjs`).

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

Navigation tests, from the repository root:

```sh
xcrun swiftc macos/Ricotta/NavigationPolicy.swift macos/Tests/main.swift -o /tmp/ricotta-mac-navigation-tests
/tmp/ricotta-mac-navigation-tests
```
