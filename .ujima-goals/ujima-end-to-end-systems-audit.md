# Ujima End-to-End Systems Audit

**Status:** planned
**Owner:** Carter Jordan
**Requested by:** Precious Vincent
**Created:** 2026-07-01

## Goal

Review Ujima end to end from onboarding through agent communication, tools, MCP/approval flow, and the agent loop. Produce a prioritized engineering audit that calls out correctness issues, inefficiencies, bottlenecks, and recommended fix sequencing.

## Scope

Included:
- Onboarding, owner session creation, starter team creation, config sync, and default skill/plugin setup.
- Agent communication: channels, DMs, mentions, wake policies, alerts, delegation, and realtime feedback.
- Tool layer: workspace file tools, shell/job tools, MCP connector attachment/invocation, approvals, audit, and path safety.
- Agent loop: context assembly, wake context, model loop retries, tool-call termination, interrupt/resume, run lifecycle, and supervisor behavior.
- Web/API feedback paths where they affect reliability or user-visible bottlenecks.

Not included in this first pass:
- Implementing fixes.
- Full UX redesign.
- Performance benchmarking beyond code-path bottleneck analysis.

## Plan

1. Map the onboarding/config-sync path and identify setup-time risks.
2. Map the conversation/wake path and identify communication failures or duplicate work.
3. Map the tool/MCP/approval path and identify safety, latency, and reliability issues.
4. Map the agent loop/run lifecycle and identify context, resume, termination, and bottleneck risks.
5. Synthesize findings into a ranked audit report with file references, severity, impact, and recommended fix order.
6. Run an independent review pass with Jerry Sloan focused on correctness of the findings.

## Task Breakdown

| # | Task | Owner | Depends on | Acceptance criteria |
|---|---|---|---|---|
| 1 | Audit onboarding and config sync | Carter Jordan | None | Onboarding risks documented with concrete code references and recommended fixes. |
| 2 | Audit agent communication and wake flow | Carter Jordan | None | Channel, DM, mention, alert, delegation, and realtime risks documented. |
| 3 | Audit tools, MCP, approvals, and workspace safety | Carter Jordan | None | Tool execution, connector, approval, audit, and path-safety issues documented. |
| 4 | Audit agent loop and run lifecycle | Carter Jordan | None | Context assembly, model loop, termination, pause/resume, and run lifecycle issues documented. |
| 5 | Synthesize prioritized audit report | Carter Jordan | 1, 2, 3, 4 | Findings ranked by severity/impact with bottlenecks and fix sequence. |
| 6 | Independent validation review | Jerry Sloan | 5 | Reviewer checks findings for accuracy and missing high-risk issues. |

## Initial Research Notes

Research already inspected core docs and code areas:
- `README.md`
- `docs/adr/0002-adopt-ujima-agents-philosophy.md`
- `docs/systems-thinking-audit.md`
- `packages/orchestrator/src/services/onboarding.ts`
- `apps/api/src/transport/routes/onboarding.ts`
- `packages/orchestrator/src/services/config-sync.ts`
- `packages/orchestrator/src/services/conversation.ts`
- `packages/orchestrator/src/services/spirit-service-base.ts`
- `packages/orchestrator/src/services/spirit-supervisor.ts`
- `packages/orchestrator/src/services/tool-service-impl.ts`
- `packages/orchestrator/src/services/mcp-registry.ts`
- `packages/orchestrator/src/services/mcp-runtime.ts`
- `packages/orchestrator/src/services/agent-loop.ts`
- `packages/agent-core/src/loop.ts`
- `apps/web/src/features/workspace/use-conversation-sync.ts`
- `apps/web/src/features/workspace/workspace-store.ts`

User selected the artifact scope: prioritized audit report only, with file references and recommended fix sequence.

## Current Known Findings to Verify

- Owner may be excluded from role-derived channel membership during onboarding because only agent members are included in the role membership map.
- Onboarding/config sync has multiple sources of truth and may hide malformed channel/member configuration as partial population.
- DM and mention wake delivery has several overlapping fanout paths that can duplicate or suppress agent alerts.
- Wake context can be reconstructed indirectly from run/session/thread state, which risks losing the exact source message or interrupt reason.
- Tool and MCP flows are safety-conscious, but schema/tool palette size, connector startup, and approval resume paths need bottleneck review.
- Agent loop retry/compaction exists, but context reduction and tool termination behavior need a focused reliability pass.

## Progress Notes

- 2026-07-01: Initial codebase research completed.
- 2026-07-01: Asked Precious Vincent to confirm report scope. Selected prioritized audit report only, no fixes yet.
- 2026-07-01: Jerry Sloan completed an initial read-only review with four concrete findings to validate and incorporate.
