#!/usr/bin/env bash
################################################################################
# npm start: full local stack in watch mode, browser opened once it answers.
#
# Runs three things: a one-shot SCSS compile, a SCSS watcher, and the Docker
# stack in the foreground. The browser opener runs as a separate process so a
# container restart does not spawn a new tab. Ctrl+C stops the watcher too.
#
# OPEN_BROWSER=0 skips opening a browser (see also: npm run start:no-open).
# PORT changes only the URL the opener polls and prints; the published host
# port itself lives in docker-compose.yml. Keep the two in sync.
################################################################################

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${PORT:-54999}"
URL="http://localhost:${PORT}/"

if [ ! -f .env ]; then
    echo "[start] .env not found. Run: cp .env.example .env, then fill it in." >&2
    exit 1
fi

if [ ! -f mediamtx.yml ]; then
    echo "[start] mediamtx.yml not found. Generate it first:" >&2
    echo "[start]   bash utils/deploy/hooks/pre-build.sh" >&2
    exit 1
fi

# Call the binary directly rather than through npx: npx adds an `npm exec`
# wrapper process, and killing the wrapper leaves the real watcher running.
SASS="./node_modules/.bin/sass"

if [ ! -x "$SASS" ]; then
    echo "[start] $SASS not found. Run: npm install" >&2
    exit 1
fi

# Compile once so the container serves styled HTML on the very first request.
echo "[start] Compiling SCSS..."
"$SASS" styles/scss:styles/css --style compressed

pids=()

cleanup() {
    for pid in "${pids[@]:-}"; do
        kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM

"$SASS" --watch styles/scss:styles/css --style compressed &
pids+=("$!")

PORT="$PORT" node utils/open-when-ready.js &
pids+=("$!")

echo ""
echo "[start] Feral TV: ${URL}"
echo "[start] Stop with Ctrl+C, or 'npm run dev:kill' if anything survives."
echo ""

# --build is ~1s when cached, and picks up nginx.conf and Dockerfile edits,
# which the compose volume mounts do not cover.
docker compose up --build
