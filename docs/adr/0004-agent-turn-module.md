# ADR 0004 — One Agent-turn module behind the preserved SpiritService facade

- **Status:** Accepted (2026-08-21)
- **Supersedes:** none
- **Related:** ADR 0002 (philosophy), architecture review 2026-08-21 (candidate A + F)

## Context

The Spirit run cluster — `spirit-service-base.ts` → `spirit-agent-run.ts` → `spirit-supervisor.ts` → `spirit-direct-run.ts` — is one object smeared across a four-level inheritance chain (~3,160 lines) with shared protected state. One agent turn requires ~110 parameter slots across eight nested option objects. Step publication exists in three near-verbatim copies (`publishStepBubble`, the inline `onStepFinish` in direct mode, `publishRunReplyTrace`). The terminal-state ladder is duplicated between spirit and direct modes, and save/emit room math has already drifted between `SpiritServiceBase.getRooms` and `RunStatePersister.getRooms`. Tests drive internals via `(service as any).advanceRun` (11 sites in `run.test.ts`) because no narrower interface exists.

## Decision

Recompose the cluster into one deep **Agent turn** module (term now canonical in `CONTEXT.md`) whose interface is a single `executeTurn(input)`; the turn prelude (model/palette/prompt/context assembly), step publication, the terminal state machine, and the cancellation guard live behind it. Replay, RunEmitter (rooms math unified with `RunStatePersister`), and PromptSuffix become internal seams private to its implementation.

The public `SpiritService` facade keeps its seven externally-called methods unchanged: `createRun`, `handleAlert`, `resumeAfterInput`, `resumeAfterApproval`, `setRunCompletedHook`, `buildMcpToolDefinitionsRouted`, `bootstrapAll`. The inheritance chain dissolves into composition.

Composition-root late-binding closures that throw "not wired" until assigned (`createDelegateRun`, `resumeRun`, `wakeMember`, the MCP tool resolver) become explicit wire-time ports on the services context, so ordering hazards are type errors instead of runtime throws.

## Why preserve the facade

The external surface is seven methods across a handful of call sites; changing it buys nothing the deepening doesn't, and every caller would churn for no locality gain. Splitting the cluster into separately-consumed public modules was considered and rejected for the same reason.

## Consequences

- `run.test.ts` scenarios survive verbatim as scenarios but migrate off `(service as any)` onto the facade and the turn module's internal seams.
- A byte-stable system-prompt pin test is added; today nothing pins prompts, so prelude unification would be unverifiable otherwise.
- Repository access narrows as part of this work: the turn module takes explicit store slices (see the migration direction documented in `repository-reader.ts`) rather than the whole `ApiRepository`.
