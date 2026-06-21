# Agent Core Strangler Refactor

**Status:** Planning
**Created:** 2026-06-21
**Owner:** Carter Jordan

## Goal

Rewrite the agent system as an incremental strangler refactor. Keep current API routes, UI behavior, DB tables, and release flow stable while moving execution into one core package: `packages/agent-core`.

Target: one kernel, one transcript builder, one model gateway, one tool gateway, one delegate model, one publishing adapter.

## Architecture (Target)

```
Web / API / Scheduler → orchestrator adapter → packages/agent-core
                                                    ├── Transcript + Prompt Assembler
                                                    ├── ModelGateway (→ llm providers)
                                                    ├── ToolGateway (builtin + MCP + policy)
                                                    ├── Delegate Supervisor (child runs)
                                                    └── Run Event Stream → Repository + Sockets + Cards
```

Packages kept:
- `packages/agent-core` — new, sole owner of run execution
- `packages/orchestrator` — application wiring: load context, call core, persist/publish
- `packages/llm` — provider bridge only (no changes needed)
- `packages/agent-runtime` — kept only if child-process hosting still needed; remove duplicate loop

No DB migration in v1. Existing `runs`, `messages`, `run_steps`, and `MessageMetadata.delegate.parentRunId` stay unchanged.

## Task Breakdown

### Phase 0: Baseline Lock
1. **Golden tests for agent-loop boundary** — add focused tests mocking the AI SDK, verifying orchestrator handles each event type correctly (normal reply, tool call, approval pause/resume, input pause/resume, cancel, delegate worker, delegate explorer)

### Phase 1: Create agent-core
2. **Create `packages/agent-core`** — add package.json, tsconfig, exports, and pure types (`AgentRunInput`, `AgentRunEvent`, `ModelGateway`, `ToolGateway`, `TranscriptItem`, `AgentMessageDraft`, `RunPolicy`). No runtime behavior yet.

### Phase 2: Move Core Logic
3. **Move Transcript + Prompt Assembly** — durable chronological replay logic into `agent-core/prompt`. Preserve current ordering: messages + run steps sorted by time/id, context at tail. Compaction explicit. Prompt-visible collections deterministic.

4. **Build `ModelGateway`** — wrap AI SDK `streamText` path and Codex app-server protocol behind one gateway. Provider quirks stay in `packages/llm`. Core sees only model events, tool calls, text chunks, usage, errors.

5. **Build `ToolGateway`** — move builtin + MCP execution, permission checks, approval/input gates, run-step persistence, audit writes, result normalization behind one gateway. Enforce explorer read-only inside gateway policy.

### Phase 3: Kernel + Events
6. **Build Event-Driven Kernel** — `runAgentTurn(input): AsyncIterable<AgentRunEvent>`. Kernel owns loop stop rules. Kernel emits events for run trace + message UI. Kernel does NOT write DB, emit sockets, or know Fastify.

### Phase 4: Wiring
7. **Build Orchestrator Adapter** — replace internals of `spirit-agent-run.ts` to load context → build transcript → create gateways → consume core events → persist/publish. Keep `spirit-direct-run.ts` and `ai-service.ts` delegating through same adapter.

8. **Delegate Supervisor** — model delegate runs as child runs in core using existing message metadata. Preserve blocking spawn behavior and status/wait/read/send/stop actions. Use `parentRunId` from metadata.

9. **Publishing Adapter** — move run-event-to-message/card/socket logic into `RunPublisher`. Stream text live, publish one message per step, attach tool cards, backfill token usage, avoid duplicate final messages.

### Phase 5: Cleanup
10. **Remove Duplicate Paths** — delete or thin: `agent-runtime/src/ai-sdk-loop.ts`, redundant wake-run in `ai-service.ts`, excess state/publishing in `spirit-agent-run.ts`. Keep compatibility exports for one release if needed.

## Decisions

- **Golden test scope:** Focused golden tests on agent-loop boundary — mock the AI SDK, verify orchestrator handles each event type correctly. Faster, lower coverage.
- No DB schema changes in this pass.
- Prefer moving code over rewriting working logic.
- Delete duplicates only after migrated path has parity tests.

## Failure Modes Preserved
- Approval required: run → `waiting_for_approval`; resume executes and continues
- Input required: run → `waiting_for_input`; answer resumes same context
- Cancel: abort signal stops loop; run → `cancelled`
- Provider errors: classified in model gateway; surfaced as run failure or retried
- Tool failure: saved as run step; visible to model as structured result
- Delegate failure: parent receives `delegate_failed`, not silent success
- Explorer write attempt: blocked by runtime policy (not prompt text)
- Codex multi-tool interrupt: coalesced correctly
- Compaction: only explicit compaction path rewrites history

## Acceptance Criteria
- Exactly one active model/tool loop exists
- All run entrypoints use `AgentRunKernel`
- `spirit-agent-run.ts` is orchestration glue, not agent brain
- `ai-service.ts` no longer owns a parallel wake/background run loop
- `agent-runtime` has no independent AI SDK loop
- Prompt replay remains chronological and cache-stable
- Delegate worker/explorer enforcement is runtime policy, not prompt text
- Existing UI/API behavior and release smoke tests still pass
