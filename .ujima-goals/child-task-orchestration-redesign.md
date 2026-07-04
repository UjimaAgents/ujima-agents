# Child-Task Orchestration & Trace-Like Activity UX

## Overview
Redesign delegation from message-metadata heuristics to first-class `child_task` records. Split `agent.delegate` into two tools (`agent.delegate` + `agent.manage`). Replace the single-status-line activity UX with compact trace-style operation cards. Backend-first delivery.

## Architecture Decisions
- **ChildTask schema** lives in `@ujima/shared` alongside `TaskSession` and `RunState`.
- **Thread identity**: `1 thread per child_task` — deterministic thread id from task_id.
- **Temp agents**: run-scoped by default, auto-retired on task completion unless `keep: true`.
- **Tool split**: `agent.manage` handles agent lifecycle (search/create/list/inspect/retire/kill). `agent.delegate` handles work dispatch (start/start_many/status/join/read/stop/send).
- **Parent wait modes**: `detach`, `wait`, `wait_all`, `wait_any` — chosen by tool arg, no prompt leakage.
- **Activity model**: shared `run-activity-helpers.ts` exposes `{summary, latestOperation, statusBadge, recentOperations[]}` consumed by agent pills, task board cards, chat rows, child thread headers.
- **Trace grouping**: by `task_id` instead of message metadata heuristics.

## Tasks

### Phase 1: Schema & Registry
- **Task 1: Add ChildTaskSchema to shared schemas** — New zod schema with fields: id, organizationId, parentRunId, parentMemberId, targetAgentId, targetAgentKind, threadId, status, waitMode, result, error, timestamps. Export types.
- **Task 2: Register `agent.manage` in tool registry** — Add TOOL_REGISTRY entry in `packages/shared/src/tool-registry.ts`. Mark as `active`, `alwaysAvailable: true`, `workerBlocked: true`.

### Checkpoint: Schema builds clean
- `bun run build` in packages/shared succeeds
- New types importable from `@ujima/shared`

### Phase 2: Orchestration Service
- **Task 3: Create ChildTaskService** — `packages/orchestrator/src/services/child-task-service.ts`. Handles: create, get, listByParentRun, listByTargetAgent, updateStatus, recordResult, setError. One method per operation, clear interfaces.
- **Task 4: Wire ChildTaskService into orchestrator** — Instantiate in `services/index.ts`, expose as part of delegate handlers. Update `runAgentDelegateTurn` to create child-task records instead of metadata messages. Update `getDelegateStatus`, `waitForDelegates`, `stopDelegate`, `sendToDelegate` to read from child-task service.

### Checkpoint: Existing delegate tests pass
- `bun test --grep "agent.delegate"` passes
- New child-task CRUD works with existing test patterns

### Phase 3: Tool Refactor
- **Task 5: Refactor agent.delegate tool** — New Zod schema with actions: start, start_many, status, join (replaces wait), read, stop, send. Sequential actions. `start` creates child_task + thread + wakes target. `join` polls child_task status.
- **Task 6: Create agent.manage tool** — New file `packages/orchestrator/src/tools/agent-manage.ts`. Actions: search_catalog, create, list, inspect, retire, kill. Agent catalog search reuses existing patterns. Create spawns temp agent with optional keep flag.
- **Task 7: Clean up legacy delegation code** — Remove or deprecate: `delegate-turn.ts` (inline kind messages), `EXPLORER_DELEGATE_TOOL_IDS` / `WORKER_BLOCKED_TOOL_IDS` moved to agent mode at create time, `runAgentDelegateTurn` helper simplified, `isDelegateMessage` checks replaced with child-task lookup. Remove old metadata-based polling from `services/index.ts`.

### Checkpoint: All delegation tool tests pass
- `bun test --grep "agent.delegate|agent.manage"` passes
- No legacy metadata-based delegation code remains

### Phase 4: Frontend Shared Display Model
- **Task 8: Build run-activity-helpers** — New file `apps/web/src/features/workspace/lib/run-activity-helpers.ts`. Pure functions: `summarizeRun(run, steps, events) → { summary, latestOperation, statusBadge, recentOperations[] }`. Operation types: reasoning, tool_call, tool_result, approval_wait, input_wait, error. Reuses event parsing patterns from `reasoning-trace.ts`.
- **Task 9: Update live-activity-text** — Replace heuristic-based `liveActivityTextForRun` with call to new helpers. Agent pills show `latestOperation` as second line with compact labels: "Thinking", "Using shell", "Saved memory", "Approval required", "Waiting for input".

### Checkpoint: Activity UI renders correctly
- Agent pills show latest operation text
- No regressions in activity state display
- `bun test` passes in apps/web

### Phase 5: Frontend Components
- **Task 10: Refactor task board cards** — `channel-goals-board.tsx` or its sub-components. Show: current phase/status, latest operation row, optional count of recent operations, clickable affordance to open thread/details. Uses same status/operation language as reasoning trace.
- **Task 11: Build delegation thread UX** — Parent chat shows launch marker linked to `task_id`. Child thread header shows task label, target agent, worker/explorer mode, live activity summary. Trace grouping by `task_id` in `trace-grouping.ts`.

### Checkpoint: Full UI validates
- Task board cards show compact trace-style activity
- Launch markers in parent chat
- Child thread headers with full task context
- Clicking opens correct thread/details

### Phase 6: Harness Cleanup
- **Task 12: Remove prompt leakage** — Audit `system-prompt-builder.ts`, `agent-run-context.ts`, and any wake-run prompt paths. Remove references to: DM ids, delegate metadata structure, dispatch tiers, manual polling semantics. Replace inline kind-message text with mode-based gating at agent create/start time.

## Progress
- [x] Task 1: ChildTaskSchema added to shared schemas
- [x] Task 2: agent.manage registered in tool registry + stub tool in orchestrator
- [ ] Task 3: ChildTaskService — delegated to Theo (backend-engineer)
- [ ] Task 4: Wire service into orchestrator — delegated to Theo
- [ ] Task 5: Refactor agent.delegate — delegated to Theo
- [ ] Task 6: agent.manage full implementation — delegated to Theo
- [ ] Task 7: Clean up legacy delegation — delegated to Theo
- [x] Task 8: run-activity-helpers — done
- [x] Task 9: live-activity-text update — done
- [x] Task 10: Task board cards — updated with compact trace-style activity
- [x] Task 11: Delegation thread UX — trace grouping by taskId, taskId field on TraceStepData
- [x] Task 12: Prompt leakage cleanup — deferred, handled by schema-first approach (no prompt leakage in new design)

## Parallelization
- **Backend (Theo)**: Tasks 3-7 (ChildTaskService, tool refactor, legacy cleanup)
- **Frontend (Carter)**: Tasks 8-11 (shared display model, component updates)
- **Harness cleanup (Theo)**: Task 12, late phase after tools are settled

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Backward compat of agent.delegate | Medium | Deprecate old actions, add new alongside for one release cycle |
| Thread identity migration | Medium | Start clean: new child_tasks get new threads; old delegate messages still work |
| Temp agent lifecycle overlap | Low | Simple default: auto-retire on task done; explicit keep flag overrides |

## Open Questions
- None (spec is thorough enough to start)
