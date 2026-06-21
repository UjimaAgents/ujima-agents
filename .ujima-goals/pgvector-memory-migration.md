# SQLite Memory + Fuzzy Search

## Goal
Revert from pgvector back to SQLite for memory storage. Add Levenshtein-based fuzzy search scoring so memory recall handles typos and partial-word matches properly.

## What changed
- **Deleted** `pgvector-memory.ts` — Postgres + OpenAI embedding dependency removed
- **Reverted** `index.ts` imports back to `memory-entries.js` (SQLite)
- **Reverted** `memory.test.ts` — removed chroma mock, added fuzzy search test case
- **Rewrote** `memory-entries.ts` `scoreMemory()` — token-level Levenshtein fuzzy matching

## Fuzzy search implementation
The old `scoreMemory` did a binary check: does the full query string appear anywhere in key/content? The new version:

1. **Tokenizes** the query into individual words (split on non-alnum)
2. **Tokenizes** each entry's key and content into word sets
3. For each query word, finds the closest word in the entry by **Levenshtein distance**
4. **Scores** each match by quality (1 − normalized edit distance), weighted 2x for key matches vs content
5. **Thresholds** to avoid spurious matches: allows up to `max(2, wordLen/3)` edits
6. **Combines** with freshness score (recently recalled entries rank higher)

This means:
- `"deploy config"` matches `"deployment.config"` (Levenshtein 2 on "deploy"→"deployment")
- `"user pref"` matches `"user.preferences"` (Levenshtein 4 on "pref"→"preferences" — within threshold)
- `"remembre"` matches `"remember"` (Levenshtein 2)
- Single unmatched words still return results by freshness instead of zero results

## Status
✅ Complete
