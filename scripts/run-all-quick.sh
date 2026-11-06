#!/bin/bash
# Quick regression pass: typecheck, unit tests, then the fast UI scripts against a local dev server.
# usage: scripts/run-all-quick.sh   (needs Playwright: NODE_PATH is set here)
set -e
cd "$(git rev-parse --show-toplevel)"
export NODE_PATH=$(npm root -g)
npx tsc --noEmit -p . && npx vitest run 2>&1 | grep -E "Tests|FAIL"
(npx vite --port 5199 >/tmp/vite.log 2>&1 &); sleep 4
trap 'pkill -f "vite --port 5199"' EXIT
for s in run-editor run-autokey run-timeline run-layers run-text run-fonts run-style-ui run-matte-ui run-presets run-align run-trim run-fxkeys; do
  out=$(timeout 150 node scripts/$s.mjs "http://localhost:5199/?debug&noloop" 2>&1 | grep -E "FAIL|Error" | head -2 || true)
  [ -n "$out" ] && echo "== $s: $out" || echo "ok $s"
done
