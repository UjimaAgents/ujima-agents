
# Ujima — Project Brief for Claude

Dense reference doc for a fresh Claude session. Paste or reference this when bringing Claude into the new org repo.

---

## 1. What Ujima is

A Slack-first organizational platform where AI agents are **peers, not tools**. Humans and agents share the same org, channels, DMs, @mentions, and presence. Task execution is a first-class **mode inside the org**, not a separate app — a "task run" opens as a thread in the channel that kicked it off.

Three load-bearing ideas that shape every decision:

1. **Org/Slack is the source of truth.** Threads, DMs, mentions are the substrate. Task runs are activity streams inside a channel; memory + audit are append-only logs on that substrate.
2. **Supervisor + worker split.** Agents stay responsive mid-run. A lightweight supervisor is lazy-spawned on DM/@mention so a busy worker can be interrupted without losing run state. Reuse sibling code where possible.
3. **Task promotion + routing as LLM decisions, not hardcoded maps.** No "promote to task" button. An AI referee classifies human messages; an `escalate` tool routes via the org chart. Conflict resolution is a separate LLM call, not a rule table.

---

## 2. Monorepo layout

pnpm workspaces + Turborepo. Root: [ujima/](ujima/).

### Apps ([apps/](ujima/apps/))
- **runtime** — Fastify 4 HTTP + socket.io 4 server. Entry [apps/runtime/src/main.ts](ujima/apps/runtime/src/main.ts), transport [apps/runtime/src/transport/server.ts](ujima/apps/runtime/src/transport/server.ts). Routes under [transport/routes/](ujima/apps/runtime/src/transport/routes/): `conversations.ts`, `onboarding.ts`, `runs.ts`, `settings.ts`, `tasks.ts`.
- **cli** — Admin CLI.
- **plugin** — IDE/editor plugin surface.
- **webview** — Dashboard UI (planned: Next.js 15 + shadcn + `@ai-sdk/react`).

### Packages ([packages/](ujima/packages/))
- **shared** — Zod schemas + types. Source of truth. [packages/shared/src/index.ts](ujima/packages/shared/src/index.ts) re-exports `types`, `messages`, `activity-stream`, `personas`, `governance`, `governance-policy`, `org-schemas`, `socket-events`. Has a `/workspace` subpath export with `assertWorkspaceBoundary` / `isPathInsideRoot`.
- **api-schema** — HTTP request/response Zod schemas. Sibling-canonical per ADR-0002 principle 9 (swagger may be stale; sibling wins). Additive layer at [packages/api-schema/src/additive/](ujima/packages/api-schema/src/additive/) for new endpoints that don't touch sibling files.
- **context-store** — better-sqlite3 persistence. Migrations in [packages/context-store/src/db.ts](ujima/packages/context-store/src/db.ts); up to `004_additive_ports` (adds `messages.tool_calls`, `workspace_members`, `todos`, `provider_bindings`).
- **runtime-core** — Host primitives: workspaces, secret-store, repositories. [runtime-host.ts](ujima/packages/runtime-core/src/runtime-host.ts) is the legacy task host.
- **orchestrator** — Service layer. All business logic sits here behind `createApiServices(context): ApiServices`. See §4.
- **agent-runtime** — Single-agent turn runner. `runConcurrent`, `runAgent`, tool-loop, watchdog. Spawns child processes via [runner.ts](ujima/packages/agent-runtime/src/runner.ts).
- **framework** — `AgentTeam({...})` DSL for defining agents/roles/workspaces in code.
- **llm** — **Legacy** hand-rolled provider adapters (`anthropic.ts`, `openai-compat.ts`, `ollama.ts`). Being deprecated; see §6.
- **permissions** — `createPermissionMiddleware`. Policy evaluation + audit write.
- **event-bus** — `createLocalEventBus` wrapping audit + pending-events.
- **mcp-client** — MCP server pool.
- **client-sdk** — Typed client for external consumers.

---

## 3. Data model

SQLite, WAL mode, migrations tracked in a `migrations` table. Key tables:

- `organizations`, `members` (role-scoped)
- `channels` (kind ∈ `general | group | dm | task-run | self`), `messages` (with `tool_calls` JSON column), `message_mentions`
- `runs`, `approvals`, `audit_events`, `pending_events`
- `workspaces`, `workspace_members`
- `todos`, `provider_bindings` (the M7 provider registry starts here)
- `agent_state`, `context` (generic KV for runner config, MCP defs)

Secrets never stored in DB. `key_ref` columns point to files under `$UJIMA_HOME/secrets/<uuid>` with mode `0600` (boot refuses if world-readable).

Canonical schemas live in [packages/shared/src/org-schemas.ts](ujima/packages/shared/src/org-schemas.ts) — includes `ChannelKindSchema`, `MessageSchema`, `MessageToolCallSchema`, `IdSchema`.

---

## 4. Service layer (`orchestrator`)

Single DI factory: [createApiServices(ctx)](ujima/packages/orchestrator/src/services/index.ts#L90). Returns:

```
ApiServices {
  ai: AiService
  tools: ToolService          // permission-gated wrapper around ToolServiceImpl
  conversations: ConversationService
  runs: RunService
  approvals: ApprovalService
  bootstrap: BootstrapService
  onboarding: OnboardingService
  settings: SettingsService
  taskPromoter: TaskPromoterService
}
```

Critical wiring detail: `approvals` ↔ `runs` is a **late-bound callback cycle**. The factory declares `let resumeRun = () => { throw }` at top, constructs `ApprovalService` with `(orgId, runId) => resumeRun(...)`, then after `RunService` is built reassigns `resumeRun = (o, r) => runs.resumeAfterApproval(o, r)`. Preserves DI cleanliness without a two-phase init.

**Tool invocation chain** — every tool call, regardless of origin, goes through [ToolServiceImpl.invoke](ujima/packages/orchestrator/src/services/tool-service-impl.ts#L50):

1. Lookup member → fail if missing.
2. Emit `tool.called` to `runRoom(runId)` and `memberRoom(memberId)`.
3. [checkToolPolicy](ujima/packages/orchestrator/src/services/policy.ts) — role must include the tool, path must be inside role's `workspaceScopes`, must pass `assertWorkspaceBoundary`.
4. If `requiresApproval` and run isn't pre-approved → create approval record, emit `waiting_for_approval`, return. User resolves via `/api/approvals/:id/resolve` → `ApprovalService` calls back into `runs.resumeAfterApproval` → `tools.allowRun(orgId, runId)` → next invocation bypasses the gate once.
5. Dispatch: `filesystem` → `read/write` via `fs/promises`, `shell` → `spawn` under workspace root, `message` → conversations service, `mcp` → not yet implemented.
6. Audit + emit `tool.result`.

---

## 5. HTTP surface

15 endpoints, all Zod-validated, live-verified against the running runtime. Grouped:

- **Onboarding / bootstrap:** `POST /api/onboarding`, `GET /api/bootstrap`
- **Settings:** `GET /api/settings/organization`, `PATCH /api/settings/organization`, `GET /api/settings/team` (503 pre-onboarding is expected)
- **Conversations:** `GET /api/channels`, `GET /api/channels/:id/messages`, `POST /api/messages`
- **Runs:** `POST /api/runs`, `GET /api/runs`
- **Approvals:** `GET /api/approvals`, `POST /api/approvals/:id/resolve`
- **Tasks (new):** `POST /api/tasks/promote` — writes `task.promoted` audit event, resolves assignee
- **Legacy host:** `GET/POST /tasks`, `GET /workspaces`, `GET /agents` — predate service layer; use `host.startTask` via `@ujima/agent-runtime`

**Schema divergences from the provided swagger** (all intentional except #6):
1. Extended `ChannelKind` with `task-run` + `self` — port-additive.
2. `MessageSchema.toolCalls` field — port-additive.
3. Sibling-canonical body shape for onboarding (differs from swagger).
4. Sibling-canonical response shape for bootstrap.
5. `RunCreateSchema.summary` now optional — more lenient than swagger.
6. **Bug, fixed:** `ApprovalResolveSchema` required `approvalId` in body while the route reads it from the path. Removed from [packages/api-schema/src/runs.ts](ujima/packages/api-schema/src/runs.ts#L19).

---

## 6. LLM architecture — split state, known deficit

Two paths exist today. **This is the #1 thing to understand:**

### Path A — `/api/runs` (AiService)
- [packages/orchestrator/src/ai-service.ts](ujima/packages/orchestrator/src/ai-service.ts).
- Uses **Vercel AI SDK**: `generateText`, `tool`, `ToolSet` from `ai`; `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`.
- This is the forward path.

### Path B — legacy `/tasks` (agent-runtime)
- [packages/agent-runtime/src/runner.ts](ujima/packages/agent-runtime/src/runner.ts) → [packages/llm/src/select.ts](ujima/packages/llm/src/select.ts).
- Uses **hand-rolled clients** in `packages/llm/src/{anthropic,openai-compat,ollama}.ts`.
- Order: `vscode-lm` → `anthropic` → `openai-compat` → `ollama`. Errors if none configured.

### What `evolution-main.md` M1.3 says to do
- **M1.3.1**: replace `@ujima/llm` clients with `@ai-sdk/*`; `LLMClient` becomes a thin adapter returning a SDK `LanguageModel`.
- **M1.3.6**: move current clients to `packages/llm/legacy/`; runtime config `orchestrator.engine = 'ai-sdk' | 'legacy'` defaulting to `ai-sdk`; delete legacy two releases after cutover.
- **M7.1.1**: provider registry table `providers(kind ∈ anthropic|openai|google|openrouter|ollama|custom)`.

### OpenRouter status
Planned (one mention in [evolution-main.md:423](ujima/evolution-main.md#L423)), **not implemented**. Trivial to add since OpenRouter is OpenAI-compat: `createOpenAI({ baseUrl: 'https://openrouter.ai/api/v1', apiKey })`. No new SDK, no new provider file — that's the whole point of finishing the AI SDK migration.

**Recommended next move:** finish M1.3 before writing more provider code. Every new hand-rolled provider file is work the migration deletes.

---

## 7. Permissions + approvals flow

Role-driven, not capability-driven. A role owns `tools: string[]` + `workspaceScopes: string[]`. [checkToolPolicy](ujima/packages/orchestrator/src/services/policy.ts) is the one authoritative check:

```
role.tools.includes(toolId) ? continue : block
path inside workspace root + role scope ? continue : block
action === 'read' ? auto-allow : requires approval
```

Approval bypass for a single run: `ToolService.allowRun(orgId, runId)` sets a sticky flag that `consumeApprovedRun` eats on the next invocation. This is how approval resolution lets the run's next tool call through without re-asking.

Every decision writes to `audit_events` with status `ok | blocked | error` and enough context to reconstruct the call.

---

## 8. Realtime (socket.io)

Path `/events`, bearer-token auth on the socket handshake. Clients subscribe with a filter (org, run, member rooms). Server uses helpers `runRoom(runId)`, `memberRoom(memberId)`, `channelRoom(channelId)` from [packages/shared/src/socket-events.ts](ujima/packages/shared/src/socket-events.ts).

Key event names (in `SocketEventNames`):
- `tool.called`, `tool.result`
- `message.created`, `message.updated`
- `run.status`, `run.event` (via `ORCHESTRATOR_EVENT_CHANNEL`)
- `approval.requested`, `approval.resolved`

Backpressure handling in the server: per-connection `queue: WsFrame[]` with `overflowed` flag; frames drop with a marker if the queue blows past budget.

---

## 9. Task promotion flow

[TaskPromoterService.promote](ujima/packages/orchestrator/src/services/task-promoter.ts):

1. Validate org exists (404 if not).
2. Resolve assignee — either explicit `agentId` in input, or pick first available agent member (409 "No agent member available" if none).
3. Write `task.promoted` audit event with `{ organizationId, assigneeId, reason, auditEventId }`.
4. Return `{ assigneeId, auditEventId }`.

Route at [apps/runtime/src/transport/routes/tasks.ts](ujima/apps/runtime/src/transport/routes/tasks.ts) maps error prefixes to HTTP codes (`"Organization not found"` → 404, `"No agent member available"` → 409, else 400) and propagates `auditEventId` on failures.

The AI classifier that decides *whether* a message should be promoted lives upstream of this — it feeds the route with `{ reason }`, and the route is purely the mechanical "create the assignment + audit it" step.

---

## 10. What's done / what's in-flight

### Done this cycle
- Full sibling port per `docs/merge-plan.md` — 7 items landed, 16 builds + 44 typecheck/lint passes.
- `004_additive_ports` migration (tool_calls, workspace_members, todos, provider_bindings).
- Extended `ChannelKind` (`task-run`, `self`).
- `MessageSchema.toolCalls` field + column serialization in repositories.
- `TaskPromoterService` + `/api/tasks/promote` route.
- Additive schema layer under [packages/api-schema/src/additive/](ujima/packages/api-schema/src/additive/).
- Live-verified all 15 swagger endpoints.
- Fixed `ApprovalResolveSchema` body bug (swagger divergence #6).

### In-flight / blockers
- **LLM migration (M1.3)** — Path A on AI SDK, Path B still on custom clients. Highest-leverage next move.
- **OpenRouter** — not wired; one-liner once M1.3 done.
- **M7 provider registry** — `provider_bindings` table exists; `providers` table + UI flow not built.
- **Supervisor/worker split** — documented philosophy; no code yet.
- **Task-mode polish (M3)** — mode engine + YAML task files + per-stage checkpoints not started.

### Known environmental state
- Running server at pid 12676, port 7811, `UJIMA_HOME=/tmp/ujima-test-home`.
- No LLM provider configured — both Path A (OpenAI auth rejects fake key) and Path B (`selectProvider` throws) require a real key or local ollama to exercise live.
- Onboarded org ID `09e19a10-d9f5-4334-9314-a0d94c2a4874`.

---

## 11. Conventions Claude should follow in this repo

- **Sibling wins over swagger.** If a schema in `api-schema` differs from swagger, don't "fix" the schema — document the divergence.
- **Additive layer for new endpoints.** Don't mutate sibling schemas. Add to `packages/api-schema/src/additive/`.
- **Services, not routes, own logic.** Fastify handlers should be ≤20 lines: parse → call service → map error. Business rules go in `orchestrator/src/services/*`.
- **No new LLM provider files** — finish M1.3 first, then new providers become one-liners on the AI SDK.
- **Zod schemas in `shared` are source of truth.** API schemas reference `IdSchema`, `ChannelKindSchema`, etc. from `@ujima/shared`.
- **Audit everything.** Any state-changing service method writes an audit row. Errors propagate `auditEventId` so clients can surface it.
- **No secrets in DB or logs.** `key_ref` pattern: UUID → file on disk, mode `0600`, boot refuses world-readable.
- **Approvals use `allowRun` bypass.** Don't add new approval gates — use the existing one.

---

## 12. Key files to read first (in order)

1. [evolution-main.md](ujima/evolution-main.md) — milestones + ADRs + open questions.
2. [packages/shared/src/org-schemas.ts](ujima/packages/shared/src/org-schemas.ts) — canonical types.
3. [packages/orchestrator/src/services/index.ts](ujima/packages/orchestrator/src/services/index.ts) — service wiring.
4. [packages/orchestrator/src/services/tool-service-impl.ts](ujima/packages/orchestrator/src/services/tool-service-impl.ts) — invocation + policy + approval loop.
5. [packages/orchestrator/src/ai-service.ts](ujima/packages/orchestrator/src/ai-service.ts) — how the AI SDK path works today.
6. [apps/runtime/src/transport/server.ts](ujima/apps/runtime/src/transport/server.ts) — route registration + socket setup.
7. [packages/context-store/src/db.ts](ujima/packages/context-store/src/db.ts) — schema migrations.

That's enough to orient any fresh Claude session in 10 minutes.
