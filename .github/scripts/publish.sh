#!/usr/bin/env bash
# Push data.json as the only file on the "data" branch. History is replaced each time, so the repo stays small.
set -euo pipefail
FILE="$1"
TMP="$(mktemp -d)"
cp "$FILE" "$TMP/data.json"
cd "$TMP"
git init -q -b data
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data.json
git commit -q -m "Price snapshot $(date -u +%FT%TZ)"
git push -q -f "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" data:data
rm -rf "$TMP"
