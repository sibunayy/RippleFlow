#!/bin/bash
# Push the current branch, open a PR via REST (GraphQL is blocked here), wait for CI, squash-merge.
# usage: scripts/ship.sh <branch> "<title>" "<body>"
# The branch must already contain origin/main (rebase first). Body gets no attribution added: put it in yourself.
set -e
cd "$(git rev-parse --show-toplevel)"
B=$1; T=$2; BODY=$3
git fetch -q origin main
git merge-base --is-ancestor origin/main HEAD || { echo "BEHIND main: rebase first (git rebase --onto origin/main <old-base>)"; exit 1; }
git push -u origin "$B" 2>&1 | tail -1
# shallow single-branch clone: track the branch or the stop hook reports an unpushed commit
git config --add remote.origin.fetch "+refs/heads/$B:refs/remotes/origin/$B" || true
git fetch -q origin "$B"; git branch -u "origin/$B" >/dev/null
TMP=$(mktemp)
python3 - "$B" "$T" "$BODY" > "$TMP" <<'PY'
import json,sys
b,t,body=sys.argv[1:4]
print(json.dumps({"title":t,"head":b,"base":"main","body":body,"draft":False}))
PY
N=$(gh api repos/sibunayy/RippleFlow/pulls --input "$TMP" --jq .number)
echo "PR $N"
for i in $(seq 1 40); do
  sleep 15
  S=$(gh api "repos/sibunayy/RippleFlow/commits/$(git rev-parse HEAD)/check-runs" --jq '[.check_runs[]|.status+":"+(.conclusion//"")]|join(",")')
  echo "$S"
  case "$S" in *failure*) echo "CI FAILED"; exit 1;; esac
  if [ -n "$S" ] && ! echo "$S" | grep -q "in_progress\|queued"; then break; fi
done
gh api -X PUT "repos/sibunayy/RippleFlow/pulls/$N/merge" -f merge_method=squash --jq .merged
gh api -X DELETE "repos/sibunayy/RippleFlow/git/refs/heads/$B" >/dev/null 2>&1 || true
