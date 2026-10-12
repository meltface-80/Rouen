#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Give a fresh Ubuntu 24.04 machine the browser and fonts the DOM suite's
# measurements were taken against (v1.9.8). The suite measures layout and
# reads pixels; text set in a different font is a different size, and every
# box around it moves — 23 tests failed on a stock GitHub runner for exactly
# that reason, none of them because the app was wrong.
#
# Pinned: Chromium 141.0.7390.37 (Playwright 1.56.1, build 1194) — its
# HEADLESS SHELL, not full Chrome — the font packages below, and Inter
# preferred for sans-serif (56-prefer-inter.conf).
#
# The headless shell matters as much as the version. It is a separate build
# (no scrollbars drawn, its own compositing), and the harness picks it first
# wherever Playwright's browsers are installed, so it is what every DOM test
# was measured in. Full Chrome of the SAME version fails 11 of them: a cover
# 485px wide in a 500px panel is a 15px scrollbar the shell never draws.
# Changing any of them changes what the suite measures: do it on purpose,
# in its own commit, with the suite re-run.
# ---------------------------------------------------------------------------
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

sudo apt-get update -qq
sudo apt-get install -y -qq --no-install-recommends \
  fonts-crosextra-caladea fonts-crosextra-carlito fonts-dejavu-core fonts-dejavu-mono \
  fonts-freefont-ttf fonts-inter fonts-ipafont-gothic fonts-liberation fonts-liberation2 \
  fonts-noto-color-emoji fonts-opensymbol fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei
sudo install -m 0644 "$HERE/56-prefer-inter.conf" /etc/fonts/conf.d/56-prefer-inter.conf
sudo fc-cache -f >/dev/null

BROWSERS="$HOME/pw-browsers"
PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" npx -y playwright@1.56.1 install --with-deps chromium
BIN="$BROWSERS/chromium_headless_shell-1194/chrome-linux/headless_shell"
test -x "$BIN" || { echo "Chromium 1194 headless shell not where expected: $BIN"; exit 1; }

echo "sans-serif → $(fc-match sans-serif)"
"$BIN" --version
# The harness reads CHROMIUM_BIN first (test/dom/harness.js).
if [ -n "${GITHUB_ENV:-}" ]; then echo "CHROMIUM_BIN=$BIN" >> "$GITHUB_ENV"; fi
