# Ricotta Lab

A place to try changes on the real app without touching the kitchen's data.
It runs the app's own files from the repository root unchanged, with two additions:

- `lab-mock.js` loads first and answers every request to the `api` Edge Function from sample data kept in the browser. Nothing reaches Supabase. It opens signed in as Rozha; after signing out, any 6 digits sign in as Rozha and `222222` as Yunis.
- `lab-panel.js` and `lab-panel.css` add a **LAB** tab with test tools: switch between Rozha and Yunis, show the sign-in page, set or break the kitchen streak, reset the sample data.

`page.html` is the app's `index.html` with these scripts added (no doctype or head; the Artifact wraps it).

One change to the app's own code, in the Lab's copy only: an Artifact shows the page inside a frame, and the app refuses to run framed (so nobody can wrap the real sign-in in another site), so `build.sh` turns that check off in `dist/app.js`. The app itself keeps it.

## Build and preview

```sh
sh lab/build.sh
python3 -m http.server 8765 --directory lab/dist
```

Then open http://localhost:8765. `lab/dist` is ignored by git; rebuild after changing the app.

`lab/build.sh` copies the app's files, so the Lab always runs the current code. When the app gets a new script, add it to the list in `build.sh`; when the API gets a new route, teach `lab-mock.js` to answer it.
