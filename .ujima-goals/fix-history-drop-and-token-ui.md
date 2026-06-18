# Improve Prompt Caching Across Turns

**Status**: ✅ Completed

## Changes Made

### Fix 1: Re-order prompt assembly for cache stability
- **File**: `packages/orchestrator/src/utils/prompt-assembly.ts`
- **What**: Moved `contextMessages` (thread-state, workspace-state, delegate-turn context) **before** dynamic history in the output array
- **Why**: Static prefix stays at a fixed byte-offset from the start across turns, preserving provider KV cache. History grows at the **end**, not the middle.
- **Before**: `[history..., contextMessages, currentRequest]`
- **After**: `[contextMessages, history..., currentRequest]`

### Fix 2: Compaction uses token counts instead of chars
- **File**: `packages/orchestrator/src/services/conversation-compact.ts`
- `conversationNeedsCompaction` now sums `message.inputTokens + message.outputTokens` instead of `message.content.length`
- Falls back to `Math.ceil(content.length / 4)` for old messages without token data
- Compares against `contextWindowTokens * 0.7` directly instead of going through `promptCharBudget`
- Removed `keepRawCount` concept entirely — no arbitrary "recent messages stay raw" carveout

### Fix 3: Cumulative token usage across steps
- **File**: `packages/orchestrator/src/services/spirit-service-base.ts`
- `emitRunTokens` now sums `inputTokens` and `outputTokens` across **all** steps, not just the last one
- Removed unused `hasTokenUsage` import

### Fix 4: Closed @-mention pending tasks
- All MCP & Skill @-Mention tasks marked completed

## Verification
- `packages/orchestrator` — compiles clean, 4 tests pass
