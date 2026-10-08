#!/bin/sh
# Builds Ricotta Lab into lab/dist: the app's own files from the repository
# root, plus the Lab's pretend server (lab-mock.js) and special themes.
#   dist/page.html   the page body, for publishing as a claude.ai Artifact
#   dist/index.html  the same page as a full document, for a local preview:
#                    python3 -m http.server 8765 --directory lab/dist
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
for f in style.css config.js icons.js i18n.js storage.js sounds.js modals.js push.js assistant.js app.js update-check.js boot.js icon-192.png apple-touch-icon.png; do
  cp "../$f" dist/
done
cp lab-mock.js lab-themes.js lab-themes.css page.html dist/
{
  printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
  cat page.html
  printf '</body></html>\n'
} > dist/index.html
echo "Built lab/dist"
