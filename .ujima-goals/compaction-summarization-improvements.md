# Compaction & Summarization Improvements

## Motivation
Study how opencode (anomalyco/opencode) handles conversation compaction and summarization, then adapt the best patterns to Ujima's agent harness.

## opencode's Approach (after analysis)

### Key Concepts
1. **Structured Summarization Template** — not free-text. Uses a fixed markdown template with 4 sections:
   - Objective, Important Details, Work State (Completed/Active/Blocked), Next Move
   
2. **Tail Preservation** — Recent turns (default 2) survive compaction intact via token budget:
   - `preserveRecentTokens`: defaults to 25% of usable context window, min 2K, max 8K
   - Only messages before the tail are summarized

3. **Iterative Summaries** — Each compaction updates the previous summary rather than creating from scratch
   - Previous summary is injected into the prompt: "Update the anchored summary below..."

4. **Tool Output Pruning** — Before compaction, tool outputs older than ~2 recent turns get their output truncated:
   - Keeps PRUNE_PROTECT (40K) tokens of recent tool output
   - Prunes older outputs when total exceeds PRUNE_MINIMUM (20K) tokens
   - Protected tools (like "skill") are never pruned

5. **Overflow Handling** — When compaction is triggered by context overflow:
   - The user's last message is replayed automatically after compaction
   - Media attachments are stripped from replayed messages
   - An auto-continue message explains the compaction

6. **Configurable** — Per-team compaction settings via config:
   - `auto`: boolean, whether to auto-compact on overflow
   - `tail_turns`: number of recent turns to preserve (default 2)
   - `prune`: boolean, whether to prune tool outputs
   - `preserve_recent_tokens`: override token budget

### Comparison with Ujima's Current Approach

| Aspect | opencode | Ujima (current) |
|--------|----------|-----------------|
| Summary format | Structured (Objective/Work State/Next Move) | Free-text or archive marker |
| Tail preservation | Yes, configurable turns | No, full truncation |
| Iterative summaries | Yes, updates previous | No, creates fresh each time |
| Tool output pruning | Yes, configurable | No |
| Overflow replay | Yes, auto-continue with explanation | No |
| Plugin hooks | `session.compacting` + `compaction.autocontinue` | No |

## Implementation Plan

### Task 1: Structured Summary Template
- Define a structured summary template in `conversation-summary.ts`
- Replace the free-text summarization prompt with the structured template
- Keep the same markdown section format used by opencode

### Task 2: Tail Preservation
- Implement tail-turn preservation in `conversation-compact.ts`
- Add `tailTurns` and `preserveRecentTokens` configuration
- Only summarize the "head" of the conversation, keep the tail intact

### Task 3: Iterative Summary Updates
- When a previous summary exists, inject it into the summarization prompt
- The model updates rather than recreates the summary
- Track the most recent user message that was included in a compaction

### Task 4: Tool Output Pruning
- Before compacting, scan run steps for old tool outputs
- Truncate outputs older than N turns to save token budget
- Add PRUNE_MINIMUM/PRUNE_PROTECT constants

### Task 5: Overflow Replay
- When compaction is triggered by context overflow, auto-replay the triggering user message
- Strip media attachments from the replayed message
- Add an explanatory note about the compaction

## Task Breakdown

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 1 | Structured Summary Template | `conversation-summary.ts`, `conversation-compact.ts` | — |
| 2 | Tail Preservation | `conversation-compact.ts`, `repository-reader.ts` (config) | 1 |
| 3 | Iterative Summary Updates | `conversation-compact.ts`, `conversation-summary.ts` | 1 |
| 4 | Tool Output Pruning | `conversation-compact.ts`, `spirit-agent-run.ts` | — |
| 5 | Overflow Replay | `conversation-compact.ts`, `conversation.ts` | 1, 2 |
