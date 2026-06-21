# Fix Memory Recall — Fuse.js not receiving entries

## Problem
Natural language queries to `memory.recall` returned nothing. `query: "amber otter"` should find `"amber-otter-812"` but returned empty.

## Root Cause
The recall function used a SQL `LIKE` pre-filter BEFORE passing entries to Fuse.js:
```sql
AND (lower(key) LIKE '%amber otter%' OR lower(content) LIKE '%amber otter%')
```
`"amber-otter-812"` doesn't match `LIKE '%amber otter%'` (dash vs space), so SQL returned 0 rows and Fuse.js never got called.

## Fix
1. **Removed SQL LIKE pre-filter entirely** — always loads entries by recency (window of 200)
2. **Fuse.js does all the scoring** — tokenization + Levenshtein handles "amber otter" → "amber-otter-812" naturally
3. **Cleaned up dead code**: removed `sanitizeLikeQuery()`, simplified `buildRecallSql()` and `buildRecallParams()`

## Files Changed
- `packages/runtime-core/src/repositories/memory-entries.ts` — removed LIKE pre-filter, cleaned up dead code

## Status
✅ Complete
