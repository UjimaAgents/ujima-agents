#!/usr/bin/env bash
# Fail when PR insertions exceed MAX_LINES (additions only — deletions/refactors do not count).
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
      additions += add
    }
    END { print additions + 0 }
  '
)"

echo "PR lines added: ${total} (limit: ${MAX_LINES}, base: ${BASE_SHA:0:7}, head: ${HEAD_SHA:0:7})"

if [ "${total}" -gt "${MAX_LINES}" ]; then
  echo "::error::PR adds more than ${MAX_LINES} lines (${total}). Split into smaller, focused PRs."
  exit 1
fi
