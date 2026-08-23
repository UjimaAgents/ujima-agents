# ADR 0005 — Workflow run liveness over the realtime bus; REST pollers deleted

- **Status:** Accepted (2026-08-21)
- **Supersedes:** none
- **Related:** ADR 0002 (principle 9 — additive schemas), ADR 0003, architecture review 2026-08-21 (candidate D)

## Context

The workflow engine and its effects layer emit zero realtime events (`workflow-engine.ts`, `workflow-effects-live.ts`: no realtime usage). The web compensates with REST polling: the run drawer polls `GET /api/workflow-runs/{id}` every 2.5 s while active, and the runs indicator polls three list endpoints every 8 s. Two liveness mechanisms now coexist (socket events for agent runs, polling for workflow runs), and the approval drawer an operator stares at can lag seconds behind reality.

## Decision

Workflow runs publish liveness over the existing realtime bus. Additive `workflow.*` socket events are defined in `@ujima/shared`'s `SocketEventNames`/`SocketEventSchemas`; `LiveWorkflowEffects` gains a `RealtimeService` port and emits on run/node transitions. The engine itself stays free of realtime concerns — the seam is the effects adapter, matching its existing design. The SSE bridge whitelists the new events; the web consumers subscribe through it and the REST pollers are deleted outright (no dual-run period). Stalled-run coverage remains the scheduler sweep's job.

Folded into this change:

- `latestNodeRuns` moves to `@ujima/shared` as the canonical implementation; the line-for-line reimplementation in `workflow-run-side-panel.tsx` is deleted, restoring the executor module's stated locality rule ("nothing outside may re-derive latest-per-node").
- The ad-hoc `metadata.workflowRunMarker` shape is typed in `@ujima/api-schema`.
- Dead interface members go: `recoverInFlight` (zero callers) is deleted, `stepRun` becomes private, the unused `getWorkflowDefinitionByName` leaves the engine store port, and the thrice-hand-written node-run base literal collapses into a factory.

## Why

One liveness mechanism repo-wide; instant approval-drawer updates; no engine changes needed. New event names only — additive per ADR 0002 principle 9. Replacing (rather than keeping) the pollers was chosen deliberately: the sweep already covers stalled runs, and a second mechanism would preserve exactly the drift this decision removes.

## Consequences

Workflow surfaces depend on socket connectivity like every other live surface in the product. REST endpoints remain for initial loads and non-live reads.
