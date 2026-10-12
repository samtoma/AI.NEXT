#!/usr/bin/env bash
# Render the founders' report to ONE continuous PDF page (no A4 breaks).
# Pass 1 measures the laid-out height (after web fonts load); pass 2 prints at exactly that page size.
# Usage: ./render.sh [chrome-binary]   (defaults to Playwright's headless shell, then Google Chrome)
set -euo pipefail
cd "$(dirname "$0")"
SRC=g10-ingestion-report.html
OUT=AI.Next-G10-Maths-Ingestion-Report-2026-10-02-app-v0.11.0-rev1.pdf
CH="${1:-$(ls -d ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell 2>/dev/null | tail -1)}"
[ -x "$CH" ] || CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP=$(mktemp -d)
run() { "$CH" --no-sandbox --hide-scrollbars --window-size=1000,1200 --virtual-time-budget=20000 "$@" 2>/dev/null & local p=$!
        for _ in $(seq 1 60); do sleep 1; kill -0 $p 2>/dev/null || return 0; done; kill $p 2>/dev/null || true; }
run --dump-dom "file://$PWD/$SRC" > "$TMP/dom.html"
H=$(grep -o 'data-h="[0-9]*"' "$TMP/dom.html" | grep -o '[0-9]*')
[ -n "$H" ] || { echo "could not measure height" >&2; exit 1; }
sed "s#</style>#@page { size: 1000px $((H + 4))px; margin: 0; }\n</style>#" "$SRC" > "$TMP/print.html"
cp -R "$PWD"/*.png "$TMP"/ 2>/dev/null || true
run --no-pdf-header-footer --print-to-pdf-no-header --print-to-pdf="$PWD/$OUT" "file://$TMP/print.html"
rm -rf "$TMP"
echo "height ${H}px -> $OUT"
command -v pdfinfo >/dev/null && pdfinfo "$OUT" | grep -E "Pages|Page size"
