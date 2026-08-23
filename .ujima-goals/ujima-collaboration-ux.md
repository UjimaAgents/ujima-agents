# Ujima Collaboration UX

## Goal
Make Ujima's collaboration loop materially easier to use by improving task-run visibility, artifact discovery, search/recall, goals/commitments, and approval workflows.

## Current state
- Core chat, DMs, mentions, task runs, approvals, MCP tools, workspace traces, memory/recall, commitments, CLI onboarding, and multi-provider support are present.
- The web app builds successfully with TypeScript.
- The current working tree includes a trace-layout/details-sidebar refactor and other unrelated changes; implementation must avoid clobbering them.
- Claude Code provider runtime and end-to-end verification remain outstanding.

## Plan
1. Make approvals auditable and reversible: expose persisted grants, support revoke, and preserve resolver/rejection history.
2. Build a unified task-run command center over existing sessions, child tasks, workflow nodes, steps, approvals, artifacts, and updates.
3. Add a first-class artifact registry with stable links, previews/diffs, producer/run ownership, versions, checksums, and access policy.
4. Add a commitment/recall projection linking promises, goals, owners, evidence, artifacts, decisions, and stale state.
5. Add bounded, filterable audit history and run the web/orchestrator verification suite.

## Tasks
| Task | Owner | Status |
|---|---|---|
| Baseline current UX and define acceptance criteria | Carter Jordan | Pending |
| Approval grants and resolution history | Jerry Sloan | Pending |
| Unified task-run command center/read model | Carter Jordan | Pending |
| Artifact registry and run-linked delivery | Theo Reed | Pending |
| Commitment graph and filtered recall | Carter Jordan | Pending |
| Integrated verification and release recommendation | Carter Jordan | Pending |

## Decisions
- Prioritize collaboration power over a new provider or cosmetic feature.
- Start with the approval/audit spine because invisible permanent grants are a security and operator-control gap.
- Next build one task-run command center rather than adding disconnected cards to several surfaces.
- Prefer a narrow, shippable vertical slice over a broad rewrite.
- Preserve daemon-side secret handling, workspace boundaries, approvals, and additive API contracts.

## Progress notes
- Research completed: CONTEXT.md, ADRs 0002 and 0006, README, CHANGELOG, web package scripts, current details-sidebar/trace-layout, and git status were reviewed.
- `apps/web` production build passed during review.
- Human selected collaboration improvements as the near-term direction.

## Completion
Status: Planning; implementation awaits goal board approval.
