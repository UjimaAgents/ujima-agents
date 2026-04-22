# Sibling merge plan — `ujima-agents-main/apps` → this repo

**Status:** Active. **Owner:** `caleb@paidhr.com`. **Last updated:** 2026-04-21.
**Related:** [evolution-main.md](../evolution-main.md) · [ADR 0002](adr/0002-adopt-ujima-agents-philosophy.md) · sibling [apps/api](../../ujima-agents-main/apps/api/)

This document maps every file in `ujima-agents-main/apps` to a decision — **port**, **reconcile**, **skip**, or **override** — with the destination in our repo and the milestone it unlocks. It exists so the merge isn't re-litigated per-file during implementation.

**Core principle (reminder of [ADR 0002 principle 9](adr/0002-adopt-ujima-agents-philosophy.md)):** sibling shapes are canonical. Our ports either preserve them verbatim or document the divergence with an ADR note. `bun:sqlite` → `better-sqlite3` and `Bun.*` → Node equivalents are mechanical rewrites and do **not** count as divergence.

---

## Triage at the app level

| Sibling app | Lines | Verdict | Why |
| --- | --- | --- | --- |
| [`apps/api`](../../ujima-agents-main/apps/api/) | 4,475 | **Port heavily** | Full Fastify + socket.io + repositories + services + routes + DB init. ~2,500 lines of code we don't have to design. |
| [`apps/web`](../../ujima-agents-main/apps/web/) | ~200 (scaffold) | **Skip** | Next.js 16 skeleton; sibling's own `AGENTS.md` warns this Next version deviates from training data. M6 scaffolds Next 15 + shadcn fresh. |
| [`apps/vscode-extension`](../../ujima-agents-main/apps/vscode-extension/) | 1 | **Skip** | Stub. Our [apps/plugin](../apps/plugin/) is far ahead. |

---

## File-by-file decisions for `apps/api`

Decision key:
- **PORT** — copy, mechanical rewrites only (`bun:sqlite` → `better-sqlite3`, etc).
- **RECONCILE** — we have an existing implementation that's more mature; adapt sibling's code to call ours.
- **OVERRIDE** — we intentionally diverge; requires an ADR note.
- **SKIP** — not needed.

### Infrastructure

| Sibling file | Lines | Decision | Destination | Notes |
| --- | --- | --- | --- | --- |
| `src/index.ts` | 33 | SKIP | — | Bun entrypoint. We boot via `apps/runtime/src/main.ts`. |
| `src/server.ts` | 104 | RECONCILE | `apps/runtime/src/transport/server.ts` | We already have Fastify + socket.io with auth/TLS/backpressure. Borrow sibling's route registration pattern and error handler; keep our auth + lifecycle. |
| `src/config.ts` | 77 | RECONCILE | `packages/runtime-core/src/config.ts` | We have `$UJIMA_HOME` resolution. Take sibling's `maybeLoadTeam` + `isAllowedLocalOrigin` helpers. |
| `src/db.ts` | 202 | PORT (mechanical) | `packages/runtime-core/migrations/003_*.sql` … `006_*.sql` | Split into milestone-scoped migrations: 003 org/members, 004 channels/threads/messages, 005 runs/approvals/audit, 006 provider_credent


ials/tool_activity. Replace `bun:sqlite` with our `better-sqlite3` + migration runner. |

### Repositories (all **PORT**, mechanical)

Port each to `packages/runtime-core/src/repositories/<name>.ts`. Row shapes parse via sibling Zod schemas from `@ujima/shared` re-exported at `@ujima/api-schema/external` (per X.9). Single-file rewrite: import `Database` from `better-sqlite3`, adjust `.query` → `.prepare` if sibling uses Bun idioms.

| Sibling file | Lines | Our path | Milestone |
| --- | --- | --- | --- |
| `repositories.ts` | 86 | `packages/runtime-core/src/repositories/index.ts` | M1.4 |
| `repositories/common.ts` | 42 | `packages/runtime-core/src/repositories/common.ts` | M1.4 |
| `repositories/bootstrap.ts` | 40 | `packages/runtime-core/src/repositories/bootstrap.ts` | M4 |
| `repositories/organization.ts` | 97 | `packages/runtime-core/src/repositories/organization.ts` | M1.4 |
| `repositories/members.ts` | 76 | `packages/runtime-core/src/repositories/members.ts` | M1.4 |
| `repositories/channels.ts` | 102 | `packages/runtime-core/src/repositories/channels.ts` | M2.1 |
| `repositories/threads.ts` | 68 | `packages/runtime-core/src/repositories/threads.ts` | M2.1 |
| `repositories/messages.ts` | 81 | `packages/runtime-core/src/repositories/messages.ts` | M2.1 |
| `repositories/runs.ts` | 100 | `packages/runtime-core/src/repositories/runs.ts` | M3.1 |
| `repositories/approvals.ts` | 114 | `packages/runtime-core/src/repositories/approvals.ts` | M3.1 (reconcile with `@ujima/permissions`) |
| `repositories/audit.ts` | 50 | `packages/runtime-core/src/repositories/audit.ts` | M2.1 (reconcile with `@ujima/context-store`) |

**Additive rows to layer on top** (not in sibling — our additions per M1.4 / M2.2.3):
- `workspace_members.role_scope_paths` JSONB (M1.4.1)
- `channels.kind` gains `task-run | self` additive values (M2.1.1)
- `messages.kind='system'` already in sibling; we add the `tool_calls` JSONB column (M3.1.2)
- New `todos` table for supervisor todo-list (M3.1.7.5)
- New `provider_bindings` table (M1.4.1, M7.1)

### Services

| Sibling file | Lines | Decision | Our path | Milestone | Notes |
| --- | --- | --- | --- | --- | --- |
| `services/index.ts` | 40 | PORT | `packages/orchestrator/src/services/index.ts` | M1.3 | DI wiring; lift as-is. |
| `services/context.ts` | 10 | PORT | `packages/orchestrator/src/services/context.ts` | M1.3 | Trivial. |
| `services/team.ts` | 43 | PORT | `packages/orchestrator/src/services/team.ts` | M1.1 | Loads `AgentTeamHandle`. |
| **`services/ai.service.ts`** | **256** | **PORT** | `packages/orchestrator/src/ai-service.ts` | **M1.3.2** | **Biggest win.** Full AI SDK `generateText` + provider resolver (Anthropic/OpenAI/Google) + tool bindings. This is the `tool-loop.ts` replacement we were going to write. Adapt tool allowlist to route through `@ujima/permissions`. |
| **`services/run.service.ts`** | **214** | **PORT with wrapping** | `packages/orchestrator/src/run-service.ts` | **M3.1** | Sibling is single-agent per run. Our wave scheduler (`packages/orchestrator/src/plan.ts`) stays the outer loop; sibling's `advanceRun` becomes the per-agent inner step. |
| `services/conversation.service.ts` | 161 | PORT | `packages/orchestrator/src/services/conversation.ts` | M2.3 | Message posting, thread management, mention fan-out. Maps to `channel.post / .reply / .dm` internal tools (M2.3.2). |
| `services/tool.service.ts` | 352 | RECONCILE | `packages/orchestrator/src/services/tool.ts` | M1.3, M2.3 | Tool dispatch + governance + audit. Our orchestrator has similar logic already; cherry-pick sibling's tool-definition patterns, keep our PathResolver + permissions wiring. |
| `services/approval.service.ts` | 72 | RECONCILE | Fold into `@ujima/permissions` | M3.1 | Our permissions gate already exists; take sibling's `ApprovalRequestSchema` lifecycle pattern, keep our gate mechanics. |
| `services/bootstrap.service.ts` | 32 | PORT | `packages/runtime-core/src/services/bootstrap.ts` | M4 | DB seed for first run. |
| `services/onboarding.service.ts` | 199 | PORT | `packages/runtime-core/src/services/onboarding.ts` + `apps/cli/src/init/` | M4 | First-run org + members + `#general` seed. Direct `ujima init` primitive. |
| `services/settings.service.ts` | 177 | PORT with OVERRIDE | `packages/runtime-core/src/services/settings.ts` | M7.1 | **Security override**: sibling stores `api_key` plaintext. We replace with `key_ref → $UJIMA_HOME/secrets/<uuid>` at `0600` (M7.1.2). See [Security overrides](#security-overrides). |

### Routes (all **PORT**)

Wrap each in our existing auth middleware. Keep sibling's Zod-validated request/response shapes verbatim; they are the canonical endpoint contract.

| Sibling file | Lines | Our path | Milestone |
| --- | --- | --- | --- |
| `routes/onboarding.ts` | 64 | `apps/runtime/src/transport/routes/onboarding.ts` | M4 |
| `routes/settings.ts` | 116 | `apps/runtime/src/transport/routes/settings.ts` | M7.1 |
| `routes/conversations.ts` | 81 | `apps/runtime/src/transport/routes/conversations.ts` | M2.3 |
| `routes/runs.ts` | 110 | `apps/runtime/src/transport/routes/runs.ts` | M3.1 |

**New routes we add on top** (per evolution-main.md, not in sibling):
- `GET /runs/:id/detail` — run drawer aggregate (M3.1.3)
- `GET /orgs`, `POST /orgs/:id/members`, etc. (M1.4.5)
- `POST /providers/:id/test`, `GET /providers` (M7.1.3)
- `POST /tasks` task-promoter gated path + audit of promoter decisions (M3.2.1, M3.2.5)

### Realtime

| Sibling file | Lines | Decision | Our path | Milestone |
| --- | --- | --- | --- | --- |
| `realtime.ts` | 122 | PORT with wrapping | `apps/runtime/src/transport/realtime.ts` | M2.3 |

Sibling's `RealtimeService` defines **rooms** (`org:`, `channel:`, `thread:`, `member:`, `run:`) + subscribe/unsubscribe handlers + typed `.emit<T>()` against `SocketEventSchemas`. **We have no rooms today** — this is a real gap. Layer on top of our existing `socket.io` instance; keep our auth / backpressure / replay-buffer. Our additive frames (`member.alerted`, `conflict.raised`, `conflict.resolved`, `channel.archived`) extend `SocketEventSchemas` via the additive layer per X.9.2.

### Policy

| Sibling file | Lines | Decision | Our path |
| --- | --- | --- | --- |
| `policy.ts` | 58 | RECONCILE (keep ours) | — |

Sibling has a small `policy.ts`. Our [`@ujima/permissions`](../packages/permissions/) has the full IAM matrix. Keep ours; rewire ported sibling services to call `@ujima/permissions` instead of `policy.ts`. Close any semantic gaps as tests land.

### Schemas

| Sibling file | Lines | Decision | Our path |
| --- | --- | --- | --- |
| `schemas.ts` | 106 | PORT additive | `packages/api-schema/src/additive/requests.ts` |

Request/response DTOs. Per X.9.2, port into the additive layer; don't edit sibling-owned shapes.

### Tests

| Sibling file | Lines | Decision |
| --- | --- | --- |
| `repositories.test.ts` | 36 | PORT (run under `vitest` with our sqlite fixtures) |
| `policy.test.ts` | 65 | SKIP — ours wins |

---

## Security overrides

These are intentional divergences from sibling. Each requires a one-paragraph note in ADR 0002 (or a successor ADR).

### Provider credentials are NOT stored plaintext

Sibling `provider_credentials(api_key TEXT)` stores keys plaintext in SQLite. We replace with:

```sql
CREATE TABLE provider_credentials (
  organization_id TEXT NOT NULL,
  provider_name  TEXT NOT NULL,
  key_ref        TEXT NOT NULL,  -- pointer: $UJIMA_HOME/secrets/<uuid>
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (organization_id, provider_name)
)
```

File at `$UJIMA_HOME/secrets/<uuid>` mode `0600`, boot refuses to start if world-readable. Matches M7.1.2. Repositories layer hides the difference; `getProviderCredential(orgId, name)` returns the plaintext key by reading the file, so service-layer call sites (e.g. `ai.service.ts:121`) are source-compatible.

### Auth wraps every ported route

Sibling's routes assume unauthenticated local access. Every ported route is registered behind our existing bearer-token middleware from Epic 13. The sibling test fixtures hit the daemon with a token provided by the transport setup helper; no route-level edits needed.

---

## Port-time mechanical rewrites

Run these as a one-time pass after the initial copy:

| Before (sibling) | After (our repo) |
| --- | --- |
| `import { Database } from "bun:sqlite"` | `import Database from "better-sqlite3"` |
| `db.query(sql).all()` (Bun) | `db.prepare(sql).all()` (better-sqlite3) — note sibling sometimes uses this form already |
| `Bun.file(path).text()` | `await readFile(path, "utf8")` from `node:fs/promises` |
| `Bun.$\`cmd\`` | `execa("cmd", args)` |
| `import "./x.ts"` | `import "./x.js"` (our tsconfig uses ESM with `.js` specifiers) |
| `process.env.FOO` via Bun auto-load | Keep our existing env loading; do NOT add `dotenv`, tokens come from `$UJIMA_HOME` |

---

## Milestone rollup

Reading the file column above grouped by milestone:

- **M1.1 (AgentTeam framework):** `services/team.ts`
- **M1.3 (AI SDK orchestration):** `services/ai.service.ts`, `services/tool.service.ts` (reconcile), `services/index.ts`, `services/context.ts`
- **M1.4 (Org/member schema):** DB migration 003, `repositories/{organization,members,common,index}.ts`, `routes/members` (new)
- **M2.1 (Channels schema):** DB migration 004, `repositories/{channels,threads,messages,audit}.ts`
- **M2.3 (Channel WS + internal tools):** `realtime.ts` (rooms), `services/conversation.service.ts`, `routes/conversations.ts`
- **M3.1 (Task mode inside org shell):** DB migration 005, `services/run.service.ts` (wrap with wave scheduler), `services/approval.service.ts` (reconcile), `repositories/{runs,approvals}.ts`, `routes/runs.ts`
- **M4 (CLI `ujima init`):** `services/{bootstrap,onboarding}.service.ts`, `routes/onboarding.ts`, `repositories/bootstrap.ts`
- **M7.1 (Providers + secret store):** DB migration 006, `services/settings.service.ts` (with override), `routes/settings.ts`
- **Cross-cutting X.9:** `schemas.ts` → `@ujima/api-schema/src/additive/`

---

## Explicit non-goals

- **Do not port `apps/web`.** M6 scaffolds Next 15 fresh.
- **Do not port `apps/vscode-extension`.** M5 reshapes our existing [apps/plugin](../apps/plugin/).
- **Do not port sibling's `policy.ts`.** We have a superset at [`@ujima/permissions`](../packages/permissions/).
- **Do not adopt Bun.** Per ADR 0002 Open Question 2, this repo stays on pnpm + Turborepo + Node.
- **Do not re-export sibling `@ujima/framework` as-is.** Our `packages/ujima` (per M1.1) is the framework package; it can depend on sibling's published package if/when sibling ships to npm, but for phase 1 we copy the config surface into our own package so the monorepo is self-sufficient.

---

## Order of operations (suggested)

1. **M1.4 data layer first.** Port `db.ts` → migration 003 + 004, port all `repositories/*.ts`, reconcile `audit.ts` with context-store. No behaviour change yet; pure data access.
2. **M1.3 orchestration.** Port `ai.service.ts` + `services/index.ts` + `team.ts` + `context.ts`. Wire our `@ujima/permissions` into the tool `execute` hook. Keep `legacy/` path live for 90 days (M1.3.6).
3. **M2.3 realtime + conversation.** Port `realtime.ts` on top of our transport; port `conversation.service.ts` + `routes/conversations.ts`. First visible win: channels + DMs work end-to-end against a daemon.
4. **M3.1 runs.** Port `run.service.ts` + `approval.service.ts` + `repositories/{runs,approvals}.ts` + `routes/runs.ts`. Wrap `advanceRun` inside our wave scheduler.
5. **M4 onboarding.** Port `onboarding.service.ts` + `bootstrap.service.ts` + `routes/onboarding.ts` into `apps/cli` and `packages/runtime-core/services/`.
6. **M7.1 settings + providers.** Port `settings.service.ts` + `routes/settings.ts` with the plaintext-key override; wire secret store.

Each step is independently shippable and testable.

---

## Open questions

1. **Drizzle vs raw SQL migrations.** Sibling uses raw SQL in `db.ts`. Our runtime-core migration runner is built around raw SQL too; keep it that way rather than introducing Drizzle mid-port. Decision locked for phase 1.
2. **Sibling's `channel_members` vs our planned `channel_memberships` (M2.1.1).** Sibling's table is `(channel_id, member_id)` with no role column. We planned `(id, channel_id, member_id, role ∈ member|admin|observer, joined_at)`. Decision: **port sibling's table shape**, add the role + joined_at columns as additive, so migration is pure ADD COLUMN. Saves a schema fork.
3. **`sender_id`/`sender_kind` vs `author_id`.** Sibling uses `sender_id` + `sender_kind` on `messages`. We planned `author_id` + `kind`. Decision: **adopt sibling's naming** (`sender_id`, `sender_kind`) so the port is verbatim; update evolution-main.md M2.1.1 column names to match when the port lands.
4. **Memory table.** Sibling has `memory_entries(member_id, kind, content, metadata)` already. We deferred shared memory to phase 2. Decision: **port the table** (costs nothing), leave it unused in phase 1, Memory features in phase 2 plug straight in.

Follow-ups tracked against this plan go in [evolution-main.md](../evolution-main.md) under the relevant milestone.
