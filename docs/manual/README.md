# Business onboarding manual

`Laawol-Business-Onboarding.pdf` — the guide handed to businesses when they join.

## Regenerating it

Screenshots come from the **live console**, captured through a headless Chrome
that reuses a copy of a signed-in Chrome profile. That copy is why the session
carries over without holding a lock on the real profile, and why nothing outside
the page — desktop, other tabs, notifications — can ever appear in a shot.

```bash
# 1. Copy a signed-in profile (skip the caches; ~1 GB otherwise)
SRC="$HOME/Library/Application Support/Google/Chrome"
DST=/tmp/chrome-capture-profile
rm -rf "$DST" && mkdir -p "$DST/Profile 1"
cp "$SRC/Local State" "$DST/"
rsync -a --exclude 'Cache' --exclude 'Code Cache' --exclude 'GPUCache' \
      --exclude 'Service Worker/CacheStorage' --exclude 'blob_storage' \
      "$SRC/Profile 1/" "$DST/Profile 1/"

# 2. Capture every console section
node docs/manual/capture-console.mjs /tmp/chrome-capture-profile docs/manual/screenshots

# 3. Capture the app (needs a booted simulator with the app running)
xcrun simctl io <UDID> screenshot docs/manual/screenshots/app-01-home.png

# 4. Render the PDF
cd docs/manual && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=20000 \
  --user-data-dir=/tmp/pdfprof \
  --print-to-pdf="$PWD/Laawol-Business-Onboarding.pdf" \
  "file://$PWD/business-onboarding.html"
```

Chrome writes the PDF and then does not exit — the file is complete before it
hangs, so kill it once the file appears.

## Why not a plain screen grab

`screencapture` photographs whatever is genuinely on screen, so it depends on
the right tab being frontmost and will happily capture unrelated windows,
notifications, or private content. The console also keeps its active tab in
React state with no URL routing, so a one-shot `--screenshot` on a URL can only
ever produce the Today tab. `capture-console.mjs` drives the DevTools Protocol
instead: it clicks each sidebar item and captures what renders.

## Content

The screenshots are of a populated account. A brand-new business sees empty
queues, so the guide is written in setup order — approval, verification,
services, destinations, payouts, staff — and only then shows the operational
sections using populated data.
