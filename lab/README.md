# Ricotta Lab

A place to try changes on the real app without touching the kitchen's data.
It runs the app's own files from the repository root unchanged, with two additions:

- `lab-mock.js` loads first and answers every request to the `api` Edge Function from sample data kept in the browser. Nothing reaches Supabase. It opens signed in as Rozha; after signing out, any 6 digits sign in as Rozha and `222222` as Yunis.
- `lab-themes.js` and `lab-themes.css` add five special themes to Settings › Appearance: Halloween, Winter Citadel, Newroz, Ramadan Nights and Shaqlawa Summer. Each changes the colour tokens, draws a few background decorations and dresses Rico (hat, scarf, flag, lantern, sunglasses) without changing his face. Rico also pops up with a short themed message. A **LAB** tab on the right edge opens a panel for rating the themes and feature ideas.

`page.html` is the app's `index.html` with these scripts added (no doctype or head; the Artifact wraps it).

## Build and preview

```sh
sh lab/build.sh
python3 -m http.server 8765 --directory lab/dist
```

Then open http://localhost:8765. `lab/dist` is ignored by git; rebuild after changing the app.

The special themes are only in the Lab. Bringing one into the app means adding its token block to `style.css`, its name to `THEMES` and `THEME_LOOK` in `app.js` and to `themeNames` in `i18n.js`, and its id to `THEMES` in `supabase/functions/api/index.ts`.
