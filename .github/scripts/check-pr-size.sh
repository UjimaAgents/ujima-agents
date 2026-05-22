#!/usr/bin/env bash
# Fail when PR diff churn (insertions + deletions) exceeds MAX_LINES.
# Excludes lockfiles and packaged VSIX artifacts from the count.
set -euo pipefail

MAX_LINES="${MAX_LINES:-2000}"
BASE_SHA="${BASE_SHA:?BASE_SHA is required}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

total="$(
  git diff --numstat "${BASE_SHA}" "${HEAD_SHA}" | awk '
    $3 ~ /^(bun\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/ { next }
    $3 ~ /\.vsix$/ { next }
    {
      add = ($1 == "-" ? 0 : $1)
      del = ($2 == "-" ? 0 : $2)
      churn += add + del
    }
    END { print churn + 0 }
  '
)"

echo "PR diff churn: ${total} lines (limit: ${MAX_LINES}, base: ${BASE_SHA:0:7}, head: ${HEAD_SHA:0:7})"

if [ "${total}" -gt "${MAX_LINES}" ]; then
  echo "::error::PR exceeds ${MAX_LINES} lines of diff churn (${total}). Split into smaller, focused PRs."
  exit 1
fi
