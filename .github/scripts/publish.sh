#!/usr/bin/env bash
# Push the out folder (data.json and s/<slot>.json) as the only files on the "data" branch.
# History is replaced each time, so the repo stays small.
set -euo pipefail
SRC="$(cd "$1" && pwd)"
TMP="$(mktemp -d)"
cp -r "$SRC"/. "$TMP"/
cd "$TMP"
git init -q -b data
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A
git commit -q -m "Price snapshot $(date -u +%FT%TZ)"
git push -q -f "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data:data
rm -rf "$TMP"
