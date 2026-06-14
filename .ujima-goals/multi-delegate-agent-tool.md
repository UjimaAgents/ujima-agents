# Multi-Delegate Agent Tool

**Goal:** Turn `agent.delegate` from a single-shot blocking call into a fan-out orchestration tool. Same tool, richer interface.

**Status:** in_progress (Tasks 1-4 done, 5-7 pending)

---

## Progress

### ✅ Task 1 — Extend the tool schema
Done. Schema now has `action` (spawn/status/wait/stop/read/send), `delegates` array, `delegate_id`, `delegate_ids`, `timeout_ms`. Backward compat preserved.

### ✅ Task 2 — Non-blocking spawn
Done. `runAgentDelegateTurn` accepts `mode: 'non_blocking'` and returns `{status:'dispatched',...}` immediately. Plumbed through full stack.

### ✅ Task 3 — Implement all actions
Done. `status`, `wait`, `stop`, `read`, `send` all implemented. Context methods added to `ToolExecutionContext`. Closures in `services/index.ts`.

### ✅ Task 4 — Parent resume on delegate completion
Done. `invokeRunTerminalHook` called after run completion in `spirit-agent-run.ts`. Hook checks `sourceMessage.metadata.delegate.parentRunId` and calls `wakeMember` with `wakeReason: 'delegate_complete'`. Added `'delegate_complete'` to WakeReason schema.

### ⬜ Task 5 — Update tests
Update `agent-delegate.test.ts` for multi-spawn, status, wait, stop, read, send. Verify backward compat.

### ⬜ Task 6 — Update delegation guidance in system prompt
Update `<delegation_guidance>` in `packages/shared/src/agent-prompt.ts`.

### ⬜ Task 7 — Integration smoke test
Full-stack verification.

---

## Architecture Notes

**Delegate ID scheme:** DM message ID from initial spawn. Already unique, already links to delegate run via `sourceMessageId`.

**Parent resume:** Uses existing `runCompletedHook` infrastructure. No polling needed — the parent wakes when the delegate finishes.

**Wake reason:** New `'delegate_complete'` added to `WakeReasonSchema` in shared package.

**Files touched:**
- `packages/orchestrator/src/tools/agent-delegate.ts` — schema + all action handlers
- `packages/orchestrator/src/tools/types.ts` — `AgentDelegateResult` + context methods
- `packages/orchestrator/src/services/index.ts` — closures + wiring + hook
- `packages/orchestrator/src/services/tool-service-impl.ts` — constructor + context
- `packages/orchestrator/src/services/spirit-agent-run.ts` — hook invocation
- `packages/shared/src/socket-events.ts` — new WakeReason
