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

echo "PR lines added: ${additions}, removed: ${deletions}, net: ${net} (limit: +${MAX_LINES}, base: ${BASE_SHA:0:7}, head: ${HEAD_SHA:0:7})"

# Cap net additions only. Cleanup PRs (large negative net) always pass —
# we want to encourage deletion, not penalize it.
if [ "${net}" -gt "${MAX_LINES}" ]; then
  echo "::error::PR net additions ${net} exceed +${MAX_LINES}. Split into smaller, focused PRs."
  exit 1
fi
