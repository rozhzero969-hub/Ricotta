#!/bin/sh
# Builds Ricotta Lab into lab/dist: the app's own files from the repository
# root, plus the Lab's pretend server (lab-mock.js).
#   dist/page.html   the page body, for publishing as a claude.ai Artifact (build with: sh lab/build.sh artifact)
#   dist/index.html  the same page as a full document, for a local preview:
#                    python3 -m http.server 8765 --directory lab/dist
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
# The app's own scripts exactly as page.html loads them (a new script is never left out), plus its files.
for f in $(sed -n 's/.*<script[^>]* src="\([^"/]*\.js\)".*/\1/p' page.html | grep -v '^lab-') style.css privacy.html icon-192.png apple-touch-icon.png rico-happy.png rico-thinking.png; do
  cp "../$f" dist/
done
mkdir -p dist/supabase/functions/_shared
cp ../supabase/functions/_shared/search.js dist/supabase/functions/_shared/
cp -R ../fonts dist/fonts
cp ../install-icon.webp dist/
mkdir -p dist/vendor
cp ../vendor/xlsx-0.20.3.min.js dist/vendor/
cp lab-mock.js lab-panel.js lab-panel.css page.html dist/
# An Artifact shows the page inside a frame, and the app refuses to run framed (so nobody can wrap
# the real sign-in in another site). Only a build for an Artifact (sh lab/build.sh artifact) drops that
# guard, in the Lab's own copy; the local Lab, the tests and the app keep it.
if [ "${1:-}" = "artifact" ]; then
  guard='if(window.top!==window.self){'
  grep -qF "$guard" dist/app.js || { echo "build.sh: the frame guard in app.js changed; update build.sh" >&2; exit 1; }
  sed -i.bak 's/if(window\.top!==window\.self){/if(false){/' dist/app.js && rm dist/app.js.bak
fi
{
  printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
  cat page.html
  printf '</body></html>\n'
} > dist/index.html
echo "Built lab/dist"
