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
- **Theme** (View > Theme and Settings > Look). **Ricotta** (the default, no class) is the normal app look, exactly as
  on the website. The others each have light and dark palettes (AA), their own Order card artwork, Rico in costume and a
  quiet layer of drawings behind the page (`mac-themes.js`, `#macDecor`):
  - **Pumpkin Moon** (`halloween`): a twilight or moonlit sky, slow clouds, fog along the bottom, a few bats now and
    then, flickering candle glow on the Order card, cobwebs in the cards' corners, a jack-o'-lantern Rico.
  - **Winter Lights** (`christmas`): slow snow in three layers, twinkling fairy lights along the top, a ribbon and bow
    with holly on the Order card, frosted card edges, Rico in a Santa hat, a snow burst when every order is sent.
  - **Silver Moon** (`moonlit`): a moon, slowly twinkling stars, a rare shooting star, Erbil's citadel on the Order
    card, a crescent by the logo, a silver Rico.
  - **Google** (`google`): Google's four colours in the wordmark and loaders, Google Sans-style titles (Google Sans if
    installed, otherwise Avenir Next; no font files are shipped), Material cards, ripples, Google's search box, Rico shown
    as Gemini (on screen only).
  - **Cupid's Blush** (`pink`): blush and cream, a few slow hearts, satin bows on the cards, ribbon dividers, a cherub's
    wing by the logo, Rico with wings and a halo, hearts on +, a bow and arrow when every order is sent.
  Drawings never take a click and sit behind text and controls; motion is transform and opacity only, pauses while the
  window is hidden and stands still with Reduce Motion. The theme applies before the page paints and changes with a
  220 ms cross-fade. A saved theme that no longer exists reads as Ricotta (the old `discord` reads as Silver Moon).
- **App icon** (View > App Icon and Settings > Look): one for each theme first (Ricotta, Pumpkin Moon, Winter Lights,
  Silver Moon, Gemini, Cupid's Blush), then Gold Monogram, Order Ticket, Aurora, Glass Leaf, Copper Pot and Kitchen
  Stamp. Selecting a theme offers its matching icon in Settings. The selected icon appears in the Dock and app switcher
  while Ricotta runs; Finder and Launchpad use the bundle's icon, which is the Ricotta icon. A saved icon that no longer
  exists reads as Ricotta.

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
  (96 px, the Settings picker), and the bundle's AppIcon.appiconset from the first (default) icon. Add `--sheet out.png`
  to see all of them at 16, 32, 128 and 256 pt.
- Icon names are shared by `AppIconChoice` (`Choices.swift`), `MAC_ICONS` (`sounds.js`), `ICONS`
  (`render-icons.cjs`), and the localized names in `i18n.js` and `Localizable.xcstrings`.
- The themes' artwork lives in `mac-icons/fx-*.svg` (Order cards, Rico's costumes, bows, cobweb, holly, wing, ribbon);
  the moving background drawings are drawn by `mac-themes.js`.

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
