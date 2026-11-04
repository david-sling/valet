#!/bin/sh
# Renders the share card and the iOS touch icon from their HTML sources in og/ to PNGs in public/, with headless
# Chrome. Run from web/: pnpm og. Set CHROME to another Chromium binary if Chrome isn't in /Applications.
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
render() { # source, output, width, height
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$3,$4" --virtual-time-budget=6000 --allow-file-access-from-files \
    --screenshot="$PWD/public/$2" "file://$PWD/og/$1" >/dev/null 2>&1
  echo "public/$2"
}
render og-image.html og.png 1200 630
render apple-touch-icon.html apple-touch-icon.png 180 180
