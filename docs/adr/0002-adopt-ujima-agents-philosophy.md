# ADR 0002 — Adopt the `ujima-agents-main` philosophy as authoritative; preserve task mode inside it

- **Status:** Accepted (2026-04-20)
- **Supersedes:** portions of `evolution.md` (see §Resequencing)
- **Related:** ADR 0001 (AI SDK adoption), `ujima-agents-main/ujima_agents_plan.md`, `evolution.md`, `tasks.md`

---

## Context

Two product plans exist in this workspace:

1. **`evolution.md`** — the current forward plan. Treats agents as **task-scoped actors**; a rich task-mode runtime (wave scheduler, IAM matrix, audit log, approval gates, activity stream) is the primary surface. Organization + channels + `AgentTeam` config arrive late (Epics 28–30). Heavy on four-layer memory, dream agent, KAIROS observer, and multi-tenant cloud.
2. **`ujima-agents-main/ujima_agents_plan.md`** — a sibling plan that recasts the product as **Slack-for-agents**: an organization of persistent agent members who chat in channels, respond to `@mentions`, and collaborate under approvals. Code-first `AgentTeam({...})` config is the source of truth. AI SDK is the orchestration engine from day one. Single workspace root per org. Open `SKILL.md` standard for skills. Local-first phase one; no cloud, no proprietary memory vendors.

The two plans agree on the foundations already shipped (daemon + transport + thin clients, Epics 12–13), but diverge sharply on what "the product" feels like to the user.

## Decision

**The `ujima-agents-main` philosophy is the authoritative product shape.** Org mode is the day-to-day UX. Channels, DMs, `@mentions`, and persistent agent members are the primary surfaces. Code-first `AgentTeam({...})` config is the source of truth. AI SDK is the orchestration engine.

**Task mode is preserved as a first-class feature inside the org model.** The existing runtime's wave scheduler, governance IAM matrix, audit log, approval gates, task-graph YAML, slim mode, and activity stream are not replaced — they are the "start a coordinated run" primitive available from any channel, the CLI, or the dashboard. When a user says "run this task with the backend team," the org's members *are* the team; the task-mode runtime orchestrates their coordinated run end-to-end.

## Why

- **The two surfaces serve different loops.** Channel chat is the ambient, continuous collaboration loop (DM a reviewer, `@mention` PM on a blocker, share context in `#backend`). Task mode is the bounded, coordinated execution loop (structured YAML → wave scheduling → approvals → artifact). Both are load-bearing. Users will reach for one or the other depending on whether the work is ambient or discrete.
- **`ujima-agents-main` is tighter.** One plan, 243 lines, single-owner, local-first, one datastore, Bun-first. No conflict-detection subsystem, no dream agent, no four-layer memory, no KAIROS observer, no multi-tenant cloud. Shipping the smaller surface first and deferring the speculative subsystems protects phase one from subsystem drift.
- **Task mode already works.** The runtime in this repo ships a capable orchestrator (`packages/orchestrator`), governance (`packages/permissions`), audit (`packages/context-store`), and activity stream (`@ujima/event-bus`). Throwing any of that away to rebuild under the Slack UX would waste landed work. Preserving it as the "task" primitive under the org shell is almost free.
- **AI SDK adoption is no longer a pivot.** It's the baseline. New orchestration code lands on `@ai-sdk/*`; legacy provider clients in `@ujima/llm` and the hand-rolled `tool-loop.ts` get retired in the next-after-next milestone, not as a risky mid-roadmap swap.

## Consequences

### Principles

1. **Org-first, task-inside.** A user first sees channels and members; "start a task" is an action on a team, invoked from a channel, the dashboard, or the CLI.
2. **Code is the source of truth.** `ujima.config.ts` with `AgentTeam({...})` owns the org / members / channels / providers. The dashboard is an operating surface and validator, not a config database.
3. **AI SDK owns the inner loop.** Ujima owns the outer loop. `streamText({ model, tools, stopWhen, maxSteps })` is where a single agent turn lives; wave scheduling, conflict detection, governance gating, and memory remain ours — they run *between* `streamText` calls.
4. **One workspace root per org, hard-sandboxed.** Every filesystem / shell / git / MCP-path operation is resolved through `PathResolver` and rejected if it escapes the root. Per-role subpath restrictions layer on top.
5. **Local-first in phase one.** Single owner, SQLite, no OIDC, no multi-tenant tables. Cloud is a phase-2 concern gated by an explicit go-decision.
6. **Open standards only.** `SKILL.md` for agent skills (no proprietary format). MCP for external tools. No Supermemory. No vendor lock-in on durable state.
7. **Secrets stay in the daemon.** Providers, tokens, and SKILL.md scripts execute under the daemon's policy; the extension and browser never hold provider keys.
8. **Intelligence-first.** Anything that can be abstracted to an agent decision should be — channel slug choice, "Run as task" suggestion, referee selection, mention fan-out, summarization, retry vs. escalate. Hardcode only the invariants: auth, approval gates, path-scope rejection, schema validation, budget caps, token caps, idempotency keys. Every LLM-decided behavior has a deterministic fallback if the call fails.
9. **Loosely coupled, additive schemas.** The `ujima-agents-main/packages/shared/src/schemas.ts` + `events.ts` are the canonical wire shapes. `@ujima/api-schema` re-exports them at `@ujima/api-schema/external` and only *adds* (never mutates, never removes). Runtime-specific additions (`task-run` / `self` channel kinds, `member.alerted`, `conflict.raised/resolved`, `channel.archived` frames) land as additive extensions. Breaking a sibling-defined field requires a new ADR. Round-trip tests pin the wire contract.

### In-scope (phase one)

- Organization + persistent agent members (was Epic 28).
- Channels + DMs + `@mentions` (was Epic 29).
- `AgentTeam({...})` code-first config (was Epic 30).
- AI SDK orchestration (was Epic 31).
- Multi-provider BYOK (was Epic 32).
- Thin-client VS Code plugin (was Epic 14, reshaped for channels-first).
- Next.js + shadcn + AI SDK UI dashboard (was Epic 15, reshaped).
- `ujima` CLI with `ujima init` bootstrap (was Epic 16).
- `SKILL.md` library support (new — replaces the bespoke memory stack for phase one).
- Single-workspace-root enforcement + per-role subpath scopes (finishing 12.9a/b/c).
- **Task mode preserved intact**: orchestrator wave scheduling, IAM matrix, audit log, approval gates, task YAML input, slim mode, activity stream.

### Deferred to phase 2+ (decision-gated)

- Four-layer memory + dream agent (Epics 17, 18, 20).
- KAIROS background observer (Epic 25).
- Conflict detection subsystem (Epic 21) — task mode keeps the approval-gate safety net; the richer §7b detector-and-resolve loop is a later investment.
- Memory driver abstraction (Epic 19) — phase one uses SQLite + flat markdown for agent + joint memory, no pluggable backend. Supermemory is **rejected outright** (proprietary; conflicts with principle 6).
- Docker compose self-host + managed cloud (Epics 23, 24).
- Open platform / registry / marketplace (Epic 27).
- Multi-workspace-per-daemon threading — schema exists (12.9), but phase-one product is one workspace per org.
- Cross-machine event bus (27.6).

### Explicitly rejected (no phase in this plan)

- **Supermemory driver.** Proprietary, enterprise-contract only. Conflicts with principle 6.
- **Custom low-level orchestration engine.** We rebuild on AI SDK; we do not re-invent the streaming / tool-call / provider-abstraction layer.
- **Bidirectional dashboard ↔ config sync.** Config is the source of truth; UI edits to config-owned fields revert on reconcile. `allowDashboardOverride: true` is opt-in per field.

### What retires

- Hand-rolled provider clients in `packages/llm/src/` (`anthropic.ts`, `openai.ts`, any vendor-specific client) → `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`. The `LLMClient` interface becomes a thin adapter that returns a SDK `LanguageModel`.
- Hand-rolled `tool-loop.ts` → `streamText({ model, tools, stopWhen, maxSteps })`.
- `@ujima/llm/legacy/` is kept for 90 days after the AI SDK cutover ships; then deleted.

### What gets renamed / reframed

- **"Session" → "Task run"** at the user-visible surface. The data model keeps `sessions` tables for continuity, but the UX says "Task run" because tasks are the user's mental model and sessions are an implementation detail.
- **"Agent" (task-scoped) → "Agent member"** when referring to an org member. "Agent" alone still works in code; "agent member" is the doc/UI term when a distinction matters vs. one-shot tool agents.

## Resequencing (effect on `evolution.md`)

| Old epic | Status under this ADR | Target milestone |
| --- | --- | --- |
| Epic 12 (daemon extraction) | **Done.** Keep as phase-0 foundation. | — |
| Epic 13 (transport) | **Done.** Keep as phase-0 foundation. | — |
| Epic 14 (thin-client plugin) | **Reshape.** Channels-first, not governance-first. | Phase 1 M5 |
| Epic 15 (dashboard) | **Reshape.** shadcn + AI SDK UI three-pane channels layout from day one. | Phase 1 M6 |
| Epic 16 (CLI) | **Keep**, lead with `ujima init` bootstrap (16.1a). | Phase 1 M4 |
| Epic 17–20 (memory stack, daily logs, dream) | **Defer to phase 2.** Phase 1 ships a lightweight per-agent `$UJIMA_HOME/agents/.../memory/*.md` store plus `SKILL.md` support — no joint memory, no dream pass, no driver abstraction. | Phase 2 |
| Epic 21 (conflict detection) | **Defer.** Approval gates + audit keep the safety floor for phase 1. | Phase 2 |
| Epic 22 (slim mode) | **Keep**, part of task-mode polish. | Phase 1 M3 |
| Epic 23–24 (Docker, cloud) | **Defer to phase 2.** | Phase 2 |
| Epic 25 (KAIROS observer) | **Defer.** | Phase 2 |
| Epic 26 (security / telemetry / cost) | **Partial phase 1.** Secrets-handling, FS scope, threat-model doc land in phase 1; OTel + cost meter land with Epic 32. | Phase 1 M7 |
| Epic 27 (open platform polish) | **Defer.** | Phase 3 |
| Epic 28 (orgs + members) | **Move to front.** | Phase 1 M1 |
| Epic 29 (channels / DMs / @mentions) | **Move to front.** | Phase 1 M2 |
| Epic 30 (`AgentTeam` framework) | **Move to front.** | Phase 1 M1 |
| Epic 31 (AI SDK adoption) | **Move to front** (replaces "pivot" framing with "baseline"). | Phase 1 M1 |
| Epic 32 (multi-provider BYOK) | **Keep**, lands after 28 + 31. | Phase 1 M7 |

Rough order: **M1** AgentTeam + AI SDK + org/member schema → **M2** channels/DMs → **M3** task-mode polish (slim mode, YAML, rich audit) → **M4** CLI `ujima init` → **M5** thin-client plugin (channels-first) → **M6** dashboard (channels-first) → **M7** BYOK providers + hardening → decision gate → phase 2.

## Open questions

1. **Where does the framework package live?** `ujima-agents-main` calls it `packages/ujima` and imports from `ujima`. Our repo has no such package yet — Epic 30 spec'd it. Decision: **create `packages/ujima`** (the public framework) in Phase 1 M1; the existing `@ujima/*` internal packages keep their scoped names.
2. **Bun vs. pnpm.** `ujima-agents-main` is Bun-first; this repo is pnpm/Turborepo. Decision: **stay on pnpm/Turborepo**. Bun is the contributor story in the sibling repo but this repo's CI, turbo cache, and lockfile are invested. The `ujima` CLI's first-run flow can be Bun-compatible without forcing the monorepo to migrate.
3. **How does a channel trigger a task run?** Two options: a slash command (`/task run ...` posted by a user), or an explicit "Run as task" affordance on a message/thread. Decision: **both**, with the affordance being primary UX and the slash command being the power-user path. Defer wire-up to Phase 1 M2 when channel routing lands.
4. **Task → channel feedback.** When a task run starts from `#backend`, where does its activity stream live? Decision: the task run creates a **thread** in the originating channel; activity events render as messages in that thread. Reuses Epic 29's thread primitive, no new surface.
5. **Migration from current MVP data.** Existing `examples/demo/agents/*.json` + the governance panel wiring must keep booting through the transition. Decision: the M1 schema migration reads the existing flat-file agents and materialises `orgs` + `org_members` + `workspace_members` rows (Epic 28.7), and `AgentTeam.fromFiles(...)` keeps the legacy path working for CI fixtures (Epic 30.6).
6. **How does an agent stay responsive during its own task run?** Decision: **supervisor + worker split** (see [evolution-main.md M3.1.7](../../evolution-main.md)). One persistent agent identity, two execution modes — worker runs task-run waves, supervisor is **lazy-spawned on DM or `@mention`** with a small context and a cheaper model. Both share the agent's self-channel for grounding. This replaces the alternative of "queue DMs behind the current worker turn" (would block for the length of a wave) or "always-on supervisor process" (2× cost even for idle agents).
7. **Can a supervisor write or run a tool?** Decision: **no**. Supervisor's tool allowlist is `channel.post` (to origin), `channel.read`, `self.note`, `supervisor.todo.*`. Writes/shell/git/MCP tools are worker-only. Approvals resolve only via their card's buttons — a DM cannot accept on behalf of a human. Structural invariant per principle 8 (intelligence-first keeps decisions soft, but permission boundaries stay hardcoded).
8. **Who decides a message is a task — human or AI?** Decision: **AI, via a promoter LLM turn on every human message in public/group channels** (see [evolution-main.md M3.2.1](../../evolution-main.md)). No "Run as task" button. High-confidence auto-creates the task-run channel with a 10s Cancel window; medium-confidence posts a "Yes / No / Edit team" card inline; low-confidence does nothing. `/task run` stays as the explicit power-user fallback. This fits sibling's config-first philosophy — sibling ships no UI spec and no human-click affordance; auto-promotion is the natural consequence of "define the team in code, let them convene when the work shows up." Structural invariant: only humans can originate a task; agent `@mentions` never auto-promote.
9. **How does conflict resolution route escalations across roles?** Decision: **the referee is fully LLM-decided — it reads `OrganizationChartSchema` + project context and returns both the resolution proposal *and* the audience set** (which role-group channels, which DMs, which escalation target). No hardcoded `topic → role` map, no hardcoded seniority tree. Only two fan-out targets are hardcoded (structural invariants): the task-run channel of record and each conflicting agent's self-channel. Sibling's `OrganizationChartSchema.reportsTo` is the input data; we do not redefine it.
10. **Should `conflict.raise` be exposed as an agent tool?** Decision: **no**. The detector owns "whether a conflict exists" (evidence-grade, four deterministic classes); exposing `conflict.raise` would let agents trigger heavy machinery (paused siblings + referee turn) from soft disagreement, which is abuse-prone. Instead expose an `escalate({ topic, context })` tool (X.6a) that does org-chart-aware routing for soft questions with no sibling pausing and no referee. Two tools, two signal-strength tiers.

## Consequences — what a new reader does next

- Read `evolution-main.md` (forthcoming in the follow-up restructure). That is the live plan going forward.
- `evolution.md` becomes a historical reference. Anything not re-stated in `evolution-main.md` is either shipped (phase 0) or deferred (phase 2+).
- `tasks.md` remains the MVP historical record. Superseded markers already in place (21.9, 22.6, 26.7, 27.7) carry over.
