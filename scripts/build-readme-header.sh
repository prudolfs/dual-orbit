#!/usr/bin/env bash
# Capture screenshots of the game with Playwright, then assemble them into
# the looping GIF used as the README header.
#
# Ported from `robotics-lab/scripts/build-readme-header.sh`, slimmed to the
# single Vite app. Unlike the parent project (which keypress-waits a
# wall-clock FRAME_MS and grabs *FRAME_COUNT* frames), capture here is driven
# by the Phase 3 bot bridge (`window.__BOT__`) against a deterministic
# scenario — so the number of frames and their *moments* come from
# `scenario.captureTicks`, not from wall-clock guessing.
#
# Usage:
#   scripts/build-readme-header.sh [output.gif]
#
# Env knobs (set by .env or inline; overridable):
#   SCENARIO   scenario export name from src/game/bot/scenarios
#              (default: 'gauntletScenario').
#   FRAME_MS   wall-clock ms *of GIF playback* per frame (default: 1200).
#              Sets the GIF's playback cadence; capture cadence is governed by
#              the render loop, not this knob.
#   FRAME_COUNT  informational only — capture is driven by the scenario's
#              `captureTicks`, so this is honored as an upper bound hint when
#              the scenario exposes fewer frames than requested. Left as a
#              no-op by default for parity with robotics-lab's surface.
#   WIDTH      output GIF width in pixels (height auto, kept even; default 1200).
#   FRAMERATE  GIF playback fps (defaults to 1000 / FRAME_MS).
#
# Requires: pnpm, @playwright/test (devDep), ffmpeg on PATH.
# The capture spec lives in screenshots/readme-header.spec.ts and is invoked
# via screenshots/playwright.config.ts (its own webServer, separate from the
# regular Vitest run), and the bot bridge is opted in at build time via
# VITE_BOT_BRIDGE=1 so the production *preview* build exposes window.__BOT__.

set -euo pipefail

out="${1:-docs/readme-header.gif}"
width="${WIDTH:-1200}"
frame_ms="${FRAME_MS:-1200}"
scenario="${SCENARIO:-gauntletScenario}"

# Repo-root guard (the playwright config is relative to the repo root).
if [ ! -f "package.json" ] || [ ! -f "screenshots/playwright.config.ts" ]; then
  echo "build-readme-header: must run from the repo root" >&2
  exit 1
fi
command -v ffmpeg >/dev/null || {
  echo "build-readme-header: missing dependency: ffmpeg" >&2
  exit 1
}
command -v pnpm >/dev/null || {
  echo "build-readme-header: missing dependency: pnpm" >&2
  exit 1
}

# ── 1. Capture frames with Playwright ──────────────────────────────────────
# Playwright's webServer (in screenshots/playwright.config.ts) builds the app
# with VITE_BOT_BRIDGE=1 and serves the preview build; the spec drives the bot
# bridge with the chosen scenario and writes PNGs to E2E_FRAMES_DIR.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export E2E_FRAMES_DIR="$tmp/frames"
export BOT_SCENARIO="$scenario"

echo "build-readme-header: capturing '$scenario' frames with Playwright…"
pnpm exec playwright test \
  --config "$(pwd)/screenshots/playwright.config.ts" \
  --project chromium

# Sanity: the spec must have written at least one frame sequence file.
if ! ls "$E2E_FRAMES_DIR"/frame-*.png >/dev/null 2>&1; then
  echo "build-readme-header: no frames written to $E2E_FRAMES_DIR" >&2
  exit 1
fi

count=$(ls -1 "$E2E_FRAMES_DIR"/frame-*.png | wc -l | tr -d ' ')
echo "build-readme-header: captured $count frames"

# ── 2. Assemble the GIF (two-pass palette, like robotics-lab) ──────────────
# GIF fps from FRAME_MS so playback cadence matches the authored cadence by
# default; FRAMERATE overrides it when a slower/smoother effect is wanted.
fr="${FRAMERATE:-$(awk -v ms="$frame_ms" 'BEGIN { printf "%.6f", 1000/ms }')}"
mkdir -p "$(dirname "$out")"

echo "build-readme-header: assembling GIF at ${width}px / ${fr} fps…"
# Two-pass palette generation visibly improves GIF quality over ffmpeg's
# default 256-colour quantiser.
ffmpeg -hide_banner -loglevel error -y \
  -framerate "$fr" -i "$E2E_FRAMES_DIR/frame-%04d.png" \
  -vf "scale=${width}:-2:flags=lanczos,palettegen=stats_mode=full" \
  "$tmp/palette.png"

ffmpeg -hide_banner -loglevel error -y \
  -framerate "$fr" -i "$E2E_FRAMES_DIR/frame-%04d.png" -i "$tmp/palette.png" \
  -filter_complex "[0:v]scale=${width}:-2:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a" \
  -loop 0 "$out"

echo "build-readme-header: wrote $out"
