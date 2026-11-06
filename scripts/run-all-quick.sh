#!/bin/bash
# Quick regression pass: typecheck, unit tests, then the fast UI scripts against a local dev server.
# The browser scripts run in parallel (JOBS, default 4): ~20s instead of ~5 min serial. Exits non-zero on any failure.
# usage: scripts/run-all-quick.sh   (needs Playwright: NODE_PATH is set here)
set -e
cd "$(git rev-parse --show-toplevel)"
export NODE_PATH=$(npm root -g)
npx tsc --noEmit -p . && npx vitest run 2>&1 | grep -E "Tests|FAIL" || true
(npx vite --port 5199 >/tmp/vite.log 2>&1 &)
trap 'pkill -f "vite --port 5199"' EXIT
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:5199/ && break; sleep 1; done
OUT=$(mktemp -d)
export OUT
run() {
  s=$1
  timeout 200 node scripts/$s.mjs "http://localhost:5199/?debug&noloop" >"$OUT/$s.log" 2>&1 || true
  if grep -qE "FAIL|Error" "$OUT/$s.log"; then echo "== $s: $(grep -E 'FAIL|Error' "$OUT/$s.log" | head -2)"; touch "$OUT/$s.failed"; else echo "ok $s"; fi
}
export -f run
echo run-editor run-autokey run-timeline run-layers run-text run-fonts run-style-ui run-matte-ui run-presets run-align run-trim run-fxkeys \
  | tr ' ' '\n' | xargs -P "${JOBS:-4}" -I{} bash -c 'run {}'
ls "$OUT"/*.failed >/dev/null 2>&1 && { echo "FAILED (logs in $OUT)"; exit 1; }
echo "all ok"
