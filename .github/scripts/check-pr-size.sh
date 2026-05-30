#!/usr/bin/env bash
set -euo pipefail

MAX_LINES="${MAX_LINES:-2000}"
BASE_SHA="${BASE_SHA:?BASE_SHA is required}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

eval "$(
  git diff --numstat "${BASE_SHA}" "${HEAD_SHA}" | awk '
    $3 ~ /^(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/ { next }
    $3 ~ /\.vsix$/ { next }
    {
      add = ($1 == "-" ? 0 : $1)
      del = ($2 == "-" ? 0 : $2)
      additions += add
      deletions  += del
    }
    END { printf "additions=%d; deletions=%d", additions + 0, deletions + 0 }
  '
)"

net=$(( additions - deletions ))
mag="${net#-}"

echo "PR lines added: ${additions}, removed: ${deletions}, net: ${net} (limit: ${MAX_LINES}, base: ${BASE_SHA:0:7}, head: ${HEAD_SHA:0:7})"

if [ "${mag}" -gt "${MAX_LINES}" ]; then
  echo "::error::PR net diff magnitude ${net} exceeds ${MAX_LINES}. Split into smaller, focused PRs."
  exit 1
fi
