# Ujima — Seyi Plan

**Backend-only execution plan.** Derived from [evolution-main.md](evolution-main.md) with all web/UI work dropped (M5 VS Code plugin, M6 Next.js dashboard, dashboard surfaces inside other milestones). Scope: the daemon (`apps/api`), the framework (`packages/ujima`), and everything that runs inside Node. Dashboard + extension work is explicitly deferred — this plan ends with a complete, exercised daemon + CLI; UI lands after.

**Ordering principle:** E0 (LLM migration) is first because every downstream milestone assumes a single unified AI SDK path. Every new provider file is work the cutover deletes.

---

## Principles (unchanged from evolution-main)

1. **Intelligence-first.** Soft decisions (naming, routing, task promotion, conflict resolution, escalation) are LLM-decided. Structural invariants (auth, approvals, path scopes, Zod validation, workspace-root gate) stay deterministic.
2. **Channels are the substrate.** Chat, task-run activity, conflict notices, self-thinking, approval prompts all flow through `channels` + `messages`.
3. **Additive schemas.** Sibling Zod shapes in `packages/shared` are canonical. Extensions go through `@ujima/api-schema/additive`.
4. **Agents are persistent members.** Identity, self-channel, DM threads, memory survive any single run.
5. **One workspace root per org, hard-sandboxed.** Every FS/shell/git/MCP path resolves through `PathResolver`.
6. **Secrets stay in the daemon.** `key_ref` → `$UJIMA_HOME/secrets/<uuid>` at mode `0600`; boot refuses world-readable.
7. **Local-first, single-owner, phase-1.** SQLite only, no multi-tenant.
8. **Open standards only.** SKILL.md, MCP.

---

## Current state (2026-04-22)

### Shipped
- Daemon (`apps/api`) with Fastify + socket.io, 15 HTTP endpoints live-verified
- Schema migrations up to `004_additive_ports` — `orgs`, `members`, `channels` (kind ∈ `general|group|dm`), `messages` (+ `tool_calls`), `runs`, `approvals`, `audit_events`, `workspace_members`, `todos`, `provider_bindings`
- `packages/ujima` framework DSL: `AgentTeam({...})`, `RolePreset`, `PersonalityPreset`, `defineProvider`, `normalizeAgents`, schemas
- [AiService](packages/orchestrator/src/ai-service.ts) on Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`) — powers `/api/runs`
- Modular orchestrator tools at [packages/orchestrator/src/tools/](packages/orchestrator/src/tools/) (`filesystem`, `shell`, `message`)
- `TaskPromoterService` + `POST /api/tasks/promote` route (route-level only; no LLM classifier yet)
- Bearer-token auth on every REST call + socket handshake
- `workspace-paths.ts` (`assertWorkspaceBoundary`, `isPathInsideRoot`)

### In-flight / not started
- **Legacy LLM path** (`packages/llm/src/{anthropic,openai-compat,ollama}.ts`) still hand-rolled — `agent-runtime/runner.ts:32` calls `selectProvider()` not the AI SDK
- No OpenRouter
- No config discovery / reconcile loop
- No self-channels, no `@mention` fan-out, no internal channel tools, no FTS5
- No supervisor/worker split
- No task-promoter LLM classifier
- No CLI (`packages/cli` is a stub)
- No provider registry or secret-store file-mode enforcement
- No SKILL.md loader usage
- No conflict referee / escalate tool

---

## Epic order

| | Title | Why this order |
|---|---|---|
| **E0** | **LLM migration — finish M1.3** | Every new provider file written now gets deleted by this migration. Unblocks E6 (provider registry). |
| **E1** | Config discovery + reconcile loop (M1.2) | Daemon needs `ujima.config.ts` as source of truth before adding more tables/flows. |
| **E2** | Workspace-root hardening (M1.5) | Close the sandboxing gap before shipping more tools. |
| **E3** | Channels, DMs, `@mentions`, self-channels (M2) | Messaging substrate for everything downstream. |
| **E4** | Task mode inside the org shell (M3) | Task-run channel + supervisor/worker + promoter classifier. |
| **E5** | CLI `ujima init` + core commands (M4) | First-run UX; replaces manual onboarding. |
| **E6** | Provider registry + BYOK + hardening (M7) | Backend side only (no dashboard Providers page). |
| **V** | VS Code extension tasks (M5) | Thin-client rewrite. Depends on E0 (AI SDK), E3 (channels substrate), E5 (CLI for daemon spawn). |
| **X** | Cross-cutting — SKILL.md, escalate, self-note | Ships alongside E3/E4. |

---

## E0 — LLM migration (ADR 0001 execution) — **SHIPPED 2026-04-22**

**Goal:** one AI SDK code path. Legacy clients moved to `packages/llm/src/legacy/`; runtime selects via `orchestrator.engine`; adding a provider is a one-line switch branch.

### E0.1 — Cut the legacy path over

- [x] **E0.1.1** New [packages/llm/src/select.ts](packages/llm/src/select.ts) exports `selectLanguageModel(input)` returning an AI SDK `LanguageModel`. Provider kinds: `anthropic | openai | google | openrouter | ollama`. `[packages/llm/src/types.ts](packages/llm/src/types.ts)` exports `ProviderKind`, `PROVIDER_KINDS`, `LLMError`. Legacy `selectProvider()` stays reachable via the `@ujima/llm/legacy` subpath.
- [x] **E0.1.2** New [packages/agent-runtime/src/ai-sdk-loop.ts](packages/agent-runtime/src/ai-sdk-loop.ts) (`runAiSdkLoop`) built on `streamText({ model, tools, stopWhen: stepCountIs(maxIterations) })`. Replaces the inner loop for `engine='ai-sdk'`; legacy `runToolLoop` stays in place for `engine='legacy'`. [shell.ts](packages/agent-runtime/src/shell.ts) dispatches on `AgentRunInputs.engine`.
- [x] **E0.1.3** MCP tools wrapped with AI SDK `tool({ description, inputSchema, execute })` inside the AI SDK loop. `ai-service.ts` (`/api/runs` path) continues to use `ORCHESTRATOR_TOOLS` with the same SDK `tool()` shape — no duplicate tool code between paths.
- [x] **E0.1.4** Governance gate as tool-`execute` pre-hook: permission check → approval gate → MCP call → audit. Denied calls return `{ error: "permission_denied: …" }` to the model (structured error); `rate_limited` / `token_cap_exceeded` throw a non-model-visible `LoopExit`. Matches legacy audit trail.
- [x] **E0.1.5** Cost meter reads AI SDK `usage` — `AiSdkLoopOutcome.usage = { inputTokens, outputTokens, totalTokens }` — and calls `permissions.recordUsage(agentId, total)` once per turn. OTel span wrapping deferred to a small follow-up (adds a `@opentelemetry/api` dep; not blocking E0 exit).

### E0.2 — Add OpenRouter (one-liner, realised)

- [x] **E0.2.1** `openrouter` branch in [packages/llm/src/select.ts:51](packages/llm/src/select.ts#L51) — `createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' }).chat(modelId)`. Zero new SDK deps; `baseUrl` override supported.
- [x] **E0.2.2** [packages/ujima/src/schemas.ts](packages/ujima/src/schemas.ts) adds `ProviderKindSchema = z.enum(['anthropic','openai','google','openrouter','ollama'])` and extends `ProviderConfigSchema` with `kind?: ProviderKind` + `baseUrl?: string`. Exported from `@ujima/framework`.
- [x] **E0.2.3** [ai-service.ts:resolveProviderKind](packages/orchestrator/src/ai-service.ts) falls back to the provider map key for back-compat (old configs without `kind`) and dispatches via `selectLanguageModel`. The settings validator (`validateProviderKeys`) gates on team-declared providers — no hardcoded list to extend.

### E0.3 — Legacy fallback + delete window

- [x] **E0.3.1** Moved `anthropic.ts`, `openai-compat.ts`, `ollama.ts`, `mock.ts`, `types.ts`, `select.ts` (+ their tests) to [packages/llm/src/legacy/](packages/llm/src/legacy/). `@ujima/llm/legacy` subpath export re-exports the full legacy surface (`LLMProvider`, `selectProvider`, `createAnthropicProvider`, etc.) unchanged.
- [x] **E0.3.2** `RunnerConfig.engine?: 'ai-sdk' | 'legacy'` on [runner.ts](packages/agent-runtime/src/runner.ts) + [engine.ts](packages/agent-runtime/src/engine.ts) (`resolveOrchestratorEngine`, default `'ai-sdk'`). When `engine='ai-sdk'`, reads `llm: { kind, modelId, apiKey?, baseUrl? }` or falls back to `UJIMA_LLM_KIND` / `UJIMA_LLM_MODEL_ID` / `UJIMA_LLM_API_KEY` / `UJIMA_LLM_BASE_URL` env vars.
- [x] **E0.3.3** Legacy quarantine guard test at [packages/llm/src/legacy-quarantine.bun.test.ts](packages/llm/src/legacy-quarantine.bun.test.ts). Scans `packages/` + `apps/`, fails if any file outside an explicit allowlist imports `@ujima/llm/legacy`. Also rejects deep imports like `@ujima/llm/legacy/anthropic` that would skirt the guard.

### E0.4 — Tests (bun:test; 23/23 pass)

- [x] **E0.4.1** [select.bun.test.ts](packages/llm/src/select.bun.test.ts) — 9 tests. `selectLanguageModel` resolves `anthropic`, `openai`, `google`, `openrouter`, `ollama` (default + custom base URL), asserts `apiKey` required for all except `ollama`, rejects unsupported kinds with `LLMError`.
- [x] **E0.4.2** [providers.bun.test.ts](packages/ujima/src/providers.bun.test.ts) — 6 tests. `ProviderKindSchema` accepts every kind including `openrouter`, rejects `'palm'` / `''`. `ProviderConfigSchema` round-trips openrouter + ollama configs, back-compat for `kind`-less configs, `normalizeProviders` round-trip.
- [x] **E0.4.3** [engine.bun.test.ts](packages/agent-runtime/src/engine.bun.test.ts) — 3 tests. Default `'ai-sdk'`, accepts `'legacy'`, throws on unknown.
- [x] **E0.4.4** [ai-sdk-loop.bun.test.ts](packages/agent-runtime/src/ai-sdk-loop.bun.test.ts) — 3 tests using `MockLanguageModelV3` + `simulateReadableStream`. Completed turn captures `usage.inputTokens=42`, `outputTokens=7`, `tokensUsed=49`, and `permissions.recordUsage` fires once. Permission pre-hook: denied tool returns structured error, loop completes with model's follow-up text. Approval gate: rejection path, `gateResolver.awaitDecision` called once, final text contains the human's verdict.
- [x] **E0.4.5** [legacy-quarantine.bun.test.ts](packages/llm/src/legacy-quarantine.bun.test.ts) — 2 tests. Every `@ujima/llm/legacy` import sits on the allowlist; no deep legacy imports.

### Verification (2026-04-22)

- `bun run build` — 17 packages, all green (5 s).
- `bun test packages/**/*.bun.test.ts` — **23 pass / 0 fail / 43 expect() calls** (0.2 s).
- Legacy vitest suites still pass:
  - `@ujima/llm`: 19/19 (5 files — all under `src/legacy/`).
  - `@ujima/agent-runtime`: 22/22.
  - `@ujima/framework`: 5/5.
  - `@ujima/orchestrator`: 18/18 (legacy task path).
  - `@ujima/runtime-core`: 21/21.
  - `@ujima/api` (int): 11/11.
- `bun run typecheck` clean for every package I touched. Pre-existing `@ujima/webview` failure (`ActivityEvent` / `ActivityFilter` not exported from `@ujima/shared`) is unrelated — same error on `main`.

### Follow-up (out of E0 exit scope)

- OTel span wrapping around `streamText` boundaries (E0.1.5 half): bring in `@opentelemetry/api` + wire spans when M7.4.3 ships.
- Delete `packages/llm/src/legacy/` two clean releases after cutover.
- Wire the `engine` flag up the call chain: `RunService.createRun` currently still uses the AI-SDK `AiService`; the legacy `POST /tasks` path runs through `runInRunner` which now honours the flag. Future work: let a team/role pin its engine explicitly.

---

## E1 — Config discovery + reconcile loop (M1.2)

- [ ] **E1.1** Daemon resolves `UJIMA_TEAM_CONFIG` env → `ujima.config.ts` → `ujima.config.js` at workspace root. File watcher (chokidar or `fs.watch`) triggers reconcile on save.
- [ ] **E1.2** Reconcile loop diffs `TeamConfig` against DB and applies config as authority for config-owned fields (roles, agents, channels declared in config, providers). **Never drops** non-config state (channel messages, audit rows, memory entries).
- [ ] **E1.3** Per-field `owner ∈ 'config'|'dashboard'` flag on config-managed rows. Dashboard-path edits are rejected for `owner='config'` unless `allowDashboardOverride: true` on the field. (Dashboard doesn't exist yet — this rule exists so the backend is ready when it does.)
- [ ] **E1.4** Config drops a channel → channel marked `archived_at` (no message delete). Config drops an agent → `members.retired_at` set; past messages stay readable.
- [ ] **E1.5** `ujima config validate` helper function exposed from `packages/ujima` — Zod parse + dangling-reference check (role references unknown channel, agent references unknown role). Used by CLI in E5.
- [ ] **E1.6** Tests: config change → reconcile → DB matches; unknown role in agent fails validate; channel drop archives not deletes.

---

## E2 — Workspace-root hardening (M1.5)

- [ ] **E2.1** First-run gate at the REST surface: any task / member / channel mutation before a workspace's `root_path` is set returns `ERR_NO_WORKSPACE_ROOT` (409). Already partially in place — extend to every mutation route.
- [ ] **E2.2** Wire `assertWorkspaceBoundary` + `isPathInsideRoot` at **every daemon-internal FS boundary**:
  - MCP args that name paths (`mcp-client` call site)
  - [orchestrator/src/tools/filesystem.ts](packages/orchestrator/src/tools/filesystem.ts) read/write
  - [orchestrator/src/tools/shell.ts](packages/orchestrator/src/tools/shell.ts) cwd + any path args
  - Audit log path fields
  Reject on escape with `ERR_PATH_ESCAPE` (403).
- [ ] **E2.3** Per-role subpath enforcement. `workspace_members.role_scope_paths` constrains a member's resolver to an allowlist inside the workspace root (`frontend-engineer → apps/web`).
- [ ] **E2.4** Symlink escape test: create a symlink inside the workspace root pointing outside → `PathResolver` rejects.
- [ ] **E2.5** Tests: traversal (`../../etc/passwd`), symlink escape, role-scope enforcement, seed-file migration.

---

## E3 — Channels, DMs, `@mentions`, self-channels (M2)

The messaging substrate — already partly schematised (tables + basic routes). This epic fills in internal tools, mention fan-out, self-channels, retention.

### E3.1 — Schema catch-up

- [ ] **E3.1.1** Migration `005_channels_v2`. Additive columns on existing `channels` table:
  - Extend `kind` enum to include `task-run` and `self` (already in [`ChannelKindSchema`](packages/shared/src/org-schemas.ts))
  - `parent_message_id?`, `archived_at?`
- [ ] **E3.1.2** `message_mentions(id, message_id, member_id, kind ∈ mention|assignment|fyi)` table. Extends the flat `Message.mentions` JSON array with typed intent.
- [ ] **E3.1.3** FTS5 virtual table `messages_fts(body, content=messages)` + maintenance triggers.

### E3.2 — Self-channels + default channels

- [ ] **E3.2.1** On member spawn, runtime creates a `kind='self'` channel for the member. Invisible to everyone except the member (+ admin via Audit).
- [ ] **E3.2.2** Auto-join: new agent member joining a workspace is auto-added to `#general` + its role's group channel.
- [ ] **E3.2.3** Self-channel retention is indefinite by default. Compacting is an opt-in LLM summarisation pass per M2.2.4.

### E3.3 — Internal channel tools

Expose privileged tools (bypassing MCP) to every agent member via the orchestrator tool registry:

- [ ] **E3.3.1** `channel.post({ channel_id, body, reply_to? })`
- [ ] **E3.3.2** `channel.reply({ message_id, body })`
- [ ] **E3.3.3** `channel.dm({ member_id, body })` — lazy-creates DM channel on first send. `member_id = 'self'` → routes to own self-channel.
- [ ] **E3.3.4** `channel.list({ scope: 'mine'|'all' })` — `scope='all'` excludes other members' self-channels (regression test in E3.7).
- [ ] **E3.3.5** `channel.read({ channel_id, since?, query? })` — cursor pagination; `query` hits FTS5.
- [ ] **E3.3.6** `self.note({ body })` — shorthand for posting to own self-channel. **Always allowed** (principle #1 — an agent can't be denied the ability to think).
- [ ] **E3.3.7** Governance: IAM matrix gains a `channels` pseudo-MCP so policy rows can gate e.g. `junior-qa → channel.dm(senior-*)`. `@mentions` + `self.note` bypass gate.

### E3.4 — `@mention` fan-out

- [ ] **E3.4.1** On message post, runtime parses `@<display_name>` and for each resolved member emits a `member.alerted` internal event with `{ reason, channel_id, message_id, by_member_id }`.
- [ ] **E3.4.2** Agent members wake on `member.alerted` and add the mentioning message + last-20-or-since-last-read context to their next turn. Dormant-by-default.
- [ ] **E3.4.3** Mention-storm rate limit. Max 10 `@mention` fan-outs per minute per agent per org. Beyond → queue with `member.alert_throttled` system message in `#general`. Reuses sliding-window primitive from E6.
- [ ] **E3.4.4** Self-mentions suppressed — `@<self>` in a message the agent authored doesn't re-wake it.

### E3.5 — WS frames

- [ ] **E3.5.1** Additive frame kinds in `@ujima/api-schema/additive`: `channel:message`, `channel:presence`, `thread:message`, `dm:message`, `approval:requested`, `approval:resolved`, `run:started`, `run:updated`, `run:completed`, `member:updated`, `tool:called`, `tool:result`, `member.alerted`, `channel.archived`. All persisted in `pending_events` for replay.

### E3.6 — Retention

- [ ] **E3.6.1** Default 90-day retention for `general|group|task-run`; indefinite for `dm|self`. Retention job moves rows to `$UJIMA_HOME/archives/channels/<channel_id>/<YYYY-MM>.jsonl`. FTS5 keeps querying over archives via an index file.
- [ ] **E3.6.2** Edit / delete use tombstones (`edited_at`, `deleted_at`) — history append-only. Tool-call cards render from immutable `tool_calls` column; editing prose never rewrites them.

### E3.7 — Tests

- [ ] **E3.7.1** Mention → wake → reply in same channel.
- [ ] **E3.7.2** DM lazy-creates on first send; second send reuses.
- [ ] **E3.7.3** Self-channel creation on spawn; `self.note` appends; `channel.list({ scope: 'all' })` from another member excludes it.
- [ ] **E3.7.4** Un-mentioned agents don't react.
- [ ] **E3.7.5** 11th mention in 60s → throttled + system message.
- [ ] **E3.7.6** Retention job archives; FTS5 search still hits archived rows.
- [ ] **E3.7.7** Edit + delete leave tombstones; tool-call cards still render.

---

## E4 — Task mode inside the org shell (M3)

Task runs become channels. Supervisor/worker split makes agents responsive mid-run. Task promotion is an LLM decision.

### E4.1 — Task run as a channel (M3.1)

- [ ] **E4.1.1** On `POST /api/runs` (task mode), runtime:
  1. Generates a slug via a 1-token LLM call (falls back to `task-<short-id>` on timeout).
  2. Creates `#<slug>` with `kind='task-run'`, stores `channels.task_run_id = <run id>`.
  3. Auto-adds team members + invoking human as memberships.
  4. Emits `kind='system'` message `"{names} joined"`.
  5. Optional `origin: { channel_id, message_id? }` posts link-back in origin channel.
- [ ] **E4.1.2** Per-turn agent output streams as `kind='agent'` messages in the task-run channel. Tool-call cards render inline inside the authoring message, sourced from `messages.tool_calls` JSONB. Batching at turn boundaries, not per-token.
- [ ] **E4.1.3** `GET /api/runs/:id/detail` returns `{ run: RunState, activeAgents: [{member_id, status_label}], tokens: { per_member_id }, tools: { tool_name: { count, pending } } }`. Already partly in place — extend with `activeAgents`, `tools` aggregates.
- [ ] **E4.1.4** Approval prompts render as `kind='system'` messages carrying an embedded `ApprovalRequestSchema`. Resolving posts a follow-up system message + updates the source card. Same primitive used in DMs.
- [ ] **E4.1.5** Completion posts a summary message in the task-run channel + link-backs in `#general` + origin channel. Failure → red-tinted summary.

### E4.2 — Supervisor + worker split (M3.1.7)

- [ ] **E4.2.1** **Worker loop.** Existing `runAgent` inside `streamText` (post-E0). One per agent per active run. No behaviour change.
- [ ] **E4.2.2** **Supervisor loop — lazy, on DM/`@mention` only.** When `member.alerted` fires for an agent with a live worker, spawn a lightweight `streamText` with small context: `{ recentTaskRunMessages: last 20, selfNotes: top-K, runState, alert }`. Answers in the origin channel/DM, exits.
- [ ] **E4.2.3** Supervisor defaults to the cheaper tier on the agent's `provider_bindings.fallback_order` (`claude-haiku-4-5-20251001` when worker is on `claude-opus-4-7`). Override per agent via `supervisorModel`.
- [ ] **E4.2.4** Shared state: supervisor reads the agent's self-channel. May write (`self.note`) so the worker's next turn sees "user asked about progress — I answered X". Supervisor never calls write/shell/git tools. Enforced in the tool allowlist.
- [ ] **E4.2.5** `supervisor.todo.*` internal tools — `add({body})`, `check({id})`, `list()` — backed by the existing `todos` table (already in migration `004_additive_ports`).
- [ ] **E4.2.6** Concurrency: worker turns serialized per agent (wave scheduler). Supervisor turns serialized among themselves (mutex on `member_id + 'supervisor'`). 2s debounce on rapid DMs.
- [ ] **E4.2.7** Idle agents: no live worker → DM/`@mention` wakes the regular loop (E3.4.2), no split needed.
- [ ] **E4.2.8** Cost: supervisor tokens tagged `kind:'supervisor'` in the cost meter. Per-run cap 10 supervisor turns; beyond → auto-reply pointing at task-run channel.
- [ ] **E4.2.9** Deterministic fallback: supervisor LLM fails → auto-reply `"Currently on step {n} of {slug} — last action: {summary}. Full activity in #{channel}."`
- [ ] **E4.2.10** Tests: DM mid-run responds within 2s; `todo.list` matches DB; supervisor `write_file` blocked; 11th supervisor call auto-replies; provider-fail fallback posts.

### E4.3 — Task promotion (M3.2)

- [ ] **E4.3.1** **Promoter hook.** On every `kind='human'` message in `general|group` channels (not DMs, not `self`, not `task-run`), fire a `streamText` call with `{ message, recentChannelMessages: 10, orgChart, roles, activeRuns, channelName }`. Returns `{ decision: 'promote'|'confirm'|'skip', confidence, team?, execution_mode?, slug_hint?, rationale }`.
  - `promote` (≥0.8): auto-create task-run channel + post `"Running this as a task → #{slug} · Cancel within 10s"`.
  - `confirm` (0.5–0.8): post `"Should I run this as a task with @{team}? · Yes · No · Edit team"`. Times out to No after 60s.
  - `skip` (<0.5): nothing.
- [ ] **E4.3.2** Slash command `/task run [<team>] <prompt>` stays as explicit fallback.
- [ ] **E4.3.3** Team `@mentions` by humans → promoter with `team_hint`. Agent-authored team `@mentions` wake members but **never auto-promote** (structural invariant — only humans can originate a task).
- [ ] **E4.3.4** Every promoter decision writes `audit.task_promoter` with `{decision, confidence, team, rationale, message_id}`.
- [ ] **E4.3.5** Deterministic fallback: promoter LLM fails → default `skip`. `/task run` always works.
- [ ] **E4.3.6** Rate limit: at most once per message; at most once every 3s per channel; dedupe near-identical messages within 60s.

### E4.4 — Slim mode + task YAML (M3.3)

- [ ] **E4.4.1** `runSlim(deps, { members, sequence })` — sequential execution passing prior output + browser-state snapshot. Reuse formatter at [run-task.ts:432](packages/orchestrator/src/run-task.ts#L432).
- [ ] **E4.4.2** YAML task file schema — `task_id`, `prompt`, `team`, `execution_mode`, `approvals.mode`, optional `graph`. Validated against `@ujima/api-schema`.
- [ ] **E4.4.3** Per-stage checkpointing. `context.put('task:<id>:slim:checkpoint:<stage>', state)` between stages; restart resumes from last completed stage.

### E4.5 — Tests

- [ ] **E4.5.1** Run with `origin.channel_id` → task-run channel created → activity events land in channel → summary posts to origin.
- [ ] **E4.5.2** Slim run, middle stage killed, restart resumes from checkpoint.
- [ ] **E4.5.3** Approval gate triggers system message with accept/reject.
- [ ] **E4.5.4** Promoter auto-promotes confident human message; skips vague one; never promotes agent-authored.
- [ ] **E4.5.5** Agent `@mentioning` a team wakes members but no task channel is created.

---

## E5 — CLI `ujima init` + core commands (M4)

The one-invocation first-run. Replaces the current "curl the onboarding endpoint" flow.

### E5.1 — Scaffold `packages/cli`

- [ ] **E5.1.1** Upgrade `packages/cli` (currently a stub) to a real `commander` app. Distributed as `@ujima/cli` with `ujima` bin.
- [ ] **E5.1.2** Use `bun` as the runtime per `apps/api/CLAUDE.md` — `bun` for scripts, `bun:sqlite` where applicable (the CLI itself doesn't touch SQLite; the daemon does).

### E5.2 — `ujima init`

- [ ] **E5.2.1** Interactive prompts: organization name → workspace root folder (must exist) → pick preset roles → provider keys (skip-to-configure-later allowed).
- [ ] **E5.2.2** Writes `workspace.root` via the daemon, scaffolds a starter `ujima.config.ts` with chosen roles + `#general`, generates `$UJIMA_HOME/config.json` + daemon token at mode `0600`.
- [ ] **E5.2.3** Launches daemon (`ujima daemon start`). No browser-open step (dashboard deferred).

### E5.3 — Core commands

- [ ] **E5.3.1** `ujima task run <task-file.yaml>` — start a task, stream events to stdout (NDJSON when not a TTY), exit on terminal state.
- [ ] **E5.3.2** `ujima task list`, `ujima task show <id>`.
- [ ] **E5.3.3** `ujima agent list`, `ujima agent add <def.json>`.
- [ ] **E5.3.4** `ujima gate list`, `ujima gate approve <id>`, `ujima gate reject <id>`.
- [ ] **E5.3.5** `ujima audit tail -f [--agent ...] [--tool ...]`.
- [ ] **E5.3.6** `ujima policy set <agent> <mcp> <tool> <state>` — cycle IAM states.
- [ ] **E5.3.7** `ujima daemon start|stop|status`.
- [ ] **E5.3.8** `ujima config validate` — calls E1.5.
- [ ] **E5.3.9** `ujima skill add <source>` — installs SKILL.md into `<workspace_root>/.ujima/skills/<name>/`. See X.1–X.4.
- [ ] **E5.3.10** `ujima provider add|test|list|retire` — mirrors E6.2 HTTP surface.

### E5.4 — Tests + exit codes

- [ ] **E5.4.1** Exit codes: `0` success, `1` failed agent, `2` approval pending at timeout, `3` session killed, `≥64` usage errors.
- [ ] **E5.4.2** Integration suite spawns a daemon fixture + exercises every command. Shares fixtures with the API integration tests.

---

## E6 — Provider registry + BYOK + hardening (M7, backend only)

Providers become first-class org-scoped entities with per-member routing. No dashboard page — CLI only for phase 1.

### E6.1 — Provider schema + secret store

- [ ] **E6.1.1** Migration `005_providers`:
  - `providers(id, org_id, kind, label, key_ref, base_url?, default_model, created_at, last_tested_at)` — `kind ∈ anthropic|openai|google|openrouter|ollama|custom`
  - `provider_bindings` already exists (from `004_additive_ports`); add `model_override` fill + `fallback_order` column.
- [ ] **E6.1.2** Secret store. `key_ref` points to `$UJIMA_HOME/secrets/<uuid>`; **mode `0600`; boot refuses to start if any `key_ref` is world-readable.** Secrets never logged, audited, or in OTel attributes.
- [ ] **E6.1.3** Provider API shape:
  - `GET /api/providers` → `{ id, kind, label, default_model, last_tested_at }` only — **never** keys.
  - `POST /api/providers` → add (body has key, response doesn't).
  - `POST /api/providers/:id/test` → 1-token ping, records `last_tested_at`.
  - `DELETE /api/providers/:id` → retire (key file unlinked).

### E6.2 — CLI wiring

Moves to E5.3.10 (single place).

### E6.3 — Routing + fallback

- [ ] **E6.3.1** AI SDK resolver (post-E0) reads the active member's `provider_bindings` ordered by `priority`, resolves first available provider + model, constructs `LanguageModel`.
- [ ] **E6.3.2** On provider-level error (429, 5xx, network), falls back to next binding + writes `provider.fallback` audit row with the swap.

### E6.4 — Hardening

- [ ] **E6.4.1** Prompt-injection defence. Every MCP tool response passes through a sanitizer that strips system-prompt-looking prefixes before re-entering LLM context.
- [ ] **E6.4.2** Threat model doc at `docs/security.md`. Required reading in CONTRIBUTING.
- [ ] **E6.4.3** OTel instrumentation. Spans around event bus publish, MCP tool call, agent turn, `streamText` boundaries. OTLP export configurable.
- [ ] **E6.4.4** Cost meter. Tokens in/out, $ per agent / task / workspace. Surfaced in `ujima cost show`.
- [ ] **E6.4.5** Rate limiting at the API gate. Sliding-window on `POST /api/runs`, `POST /api/providers/:id/test`, `POST /api/skills`. Reuses the `@ujima/permissions` sliding-window primitive (also consumed by E3.4.3).

### E6.5 — Tests

- [ ] **E6.5.1** Add provider → bind to member → run uses the right model.
- [ ] **E6.5.2** Primary returns 429 → fallback triggers → audit row records swap.
- [ ] **E6.5.3** `ujima.config.ts` with a raw-string `apiKey:` fails Zod validation (refuses to load).
- [ ] **E6.5.4** `GET /api/providers` response contains zero key fragments in body/headers/logs.
- [ ] **E6.5.5** Boot with world-readable key file → daemon refuses to start with `ERR_SECRET_PERMISSIONS`.

---

## V — VS Code extension tasks (M5)

**Goal:** `apps/vscode-extension` becomes a thin SDK client of the daemon. No in-process runtime. Channels-first UI with the existing governance panel preserved as a drawer.

**Current state (2026-04-22):**
- Extension spawns a full `RuntimeHost` in-process — [task-runner.ts:15](apps/vscode-extension/src/task-runner.ts#L15) imports `createRuntimeHost` from `@ujima/runtime-core` and opens `@ujima/context-store` directly.
- Panels already implemented: `governance-panel`, `agent-chat-panel`, `gate-center`, `activity-stream-panel`, `actions-tree`, `agents-tree`, `mcps-tree`, `teams-tree`, plus onboarding flows (`onboard-agent`, `onboard-agent-wizard`, `add-mcp-panel`).
- `vscode-lm-provider.ts` wraps the VS Code LM API as a custom `LLMProvider` — this plugs into the legacy `@ujima/llm` path E0 is deleting.
- `SessionController` holds authoritative state locally (mementos, tracked agents/tasks) — the opposite of what M5 wants.

### V.0 — Connection + lifecycle (M5.1)

- [ ] **V.0.1** Strip `TaskRunner.ensureInfra` (extension-side) down to a stub. Remove `createRuntimeHost` import from [task-runner.ts](apps/vscode-extension/src/task-runner.ts) and every call site that opens the DB / permissions / MCP pool in-process.
- [ ] **V.0.2** Add a `UjimaClient` singleton built from `@ujima/client-sdk`. Settings: `ujima.runtime.url` (default `http://127.0.0.1:7511` — matches daemon default; update if we change it), `ujima.runtime.token`, `ujima.runtime.autoStart: boolean`.
- [ ] **V.0.3** Local-daemon process management. If `autoStart === true` and the SDK can't reach the URL, spawn `node <resolved-path>/apps/api/dist/main.js` (or `bun`'d equivalent once E5 ships) as a detached child at activation. Write pid to `$UJIMA_HOME/daemon.pid`; reap stale pids on reconnect. Child inherits `UJIMA_HOME`, `UJIMA_PORT`, `UJIMA_BIND_HOST` from settings.
- [ ] **V.0.4** Status-bar health indicator — green (ok), yellow (reconnecting), red (disconnected). Click → QuickPick: Start daemon / Configure URL / View logs.
- [ ] **V.0.5** Deactivate handler closes the SDK connection but **does not** kill an auto-started daemon (let the user manage it via `ujima daemon stop`). If a stale pid is detected on activation, offer to adopt or kill it.

### V.1 — Channels view (M5.2, depends on E3)

- [ ] **V.1.1** New activity-bar view "Channels". Tree: workspace → channels → DMs → threads. Selecting a channel opens a webview message list rendered from `GET /api/channels` + `/api/threads/:id/messages` + WS `channel:message` / `thread:message` frames.
- [ ] **V.1.2** Message composer with `@mention` autocomplete. Uses `GET /api/orgs/:id/members?query=...` (E6 endpoint adjacent) or `/api/settings/organization` members list as an interim source. Resolved `member_id`s go into the `mentions[]` array on `POST /api/messages`.
- [ ] **V.1.3** Thread view renders task-run activity inline — tool-call cards from `messages.toolCalls`, progress affordance from `run.step`, approval cards from embedded `ApprovalRequestSchema`. Reuse the card shape once the dashboard work defines it; until then ship a minimal shadcn-free variant inline.
- [ ] **V.1.4** Self-channels (E3.2.1) do **not** appear in the Channels tree. They live under a "My notes" command in the command palette (for the human admin who wants to peek via Audit).
- [ ] **V.1.5** Task-run channels appear under a collapsible "Tasks" sub-tree with a status dot (amber pending-approval, green running, grey completed, red failed) driven by `run.status`.

### V.2 — Extract governance-ui (M5.3)

- [ ] **V.2.1** Move `apps/webview/src/Governance.tsx` (currently consumed by the extension's webview-host) into a new `packages/governance-ui` package. Exposes `<GovernancePanel />` with props for IAM matrix rows, audit tail, pending gates + callback handlers.
- [ ] **V.2.2** Extension's webview re-imports from `packages/governance-ui` instead of `apps/webview`. `HostToWebviewMessage` / `WebviewToHostMessage` shapes kept — only the handler guts change.
- [ ] **V.2.3** Handlers forward to the SDK: `setPolicy` → `POST /api/policy/set` (once it exists, E6 adjacent), `approve/reject` → `POST /api/approvals/:id/resolve`, audit tail → WS `audit.*` frames from `/events`.

### V.3 — State as view model (M5.4)

- [ ] **V.3.1** Rewrite [session-controller.ts](apps/vscode-extension/src/session-controller.ts) as a pure view model over the SDK's WS event stream. Remove `context.globalState.ujima.sessions.*` authoritative writes — `globalState` becomes a read-through cache only.
- [ ] **V.3.2** Re-render on every incoming WS frame. Backpressure: the extension already handles `overflow` frames from the server ([server.ts:273](apps/api/src/transport/server.ts#L273)); on overflow, issue a cold fetch (`GET /api/channels/...?cursor=...`) to resync.
- [ ] **V.3.3** Reconnect logic. On WS disconnect, flip status bar to yellow + backoff-retry. After N failures, flip to red + offer daemon-start QuickPick.

### V.4 — Session history migration (M5.5)

- [ ] **V.4.1** Migrate `context.globalState.ujima.sessions.history` reads to `GET /api/runs?organizationId=...` via the SDK. Keep a local read-through cache for quick startup (not authoritative).
- [ ] **V.4.2** One-time migration: on first activation after this version, read the existing `globalState` history, POST any entries not present in the daemon (if the daemon supports historical import — otherwise drop the cache with a user-visible notice; this is legacy-only data).

### V.5 — VS Code LM as AI SDK model (post-E0)

Current [vscode-lm-provider.ts](apps/vscode-extension/src/vscode-lm-provider.ts) is an `LLMProvider` — the legacy shape. After E0 lands, the daemon only takes AI SDK `LanguageModel`s, but the VS Code LM API is a unique value-add (free models via GitHub Copilot subscription).

- [ ] **V.5.1** Rewrite `vscode-lm-provider.ts` as a function returning an AI SDK `LanguageModel`. Implement the `LanguageModelV2` interface from `ai` — stream + tool-call support over `vscode.LanguageModelChat.sendRequest`.
- [ ] **V.5.2** Register the provider with the daemon via a new `provider.kind = 'vscode-lm'` in E6.1.1 + a transport shim so the daemon asks the extension (over a dedicated WS channel) to run the turn. This is the one place where the extension is **not** just a thin client — it relays LM calls because only the extension process has access to the VS Code API.
- [ ] **V.5.3** Alternative if V.5.2 is too much scope: keep `vscode-lm-provider.ts` inside the extension for extension-originated runs only, and run those runs **locally** in the extension using a minimal embedded AI SDK tool loop. Mark them `engine='vscode-lm-local'` in audit. Daemon-originated runs never use VS Code LM.
- [ ] **V.5.4** Decision gate: pick V.5.2 or V.5.3 at the start of V.5. Default to V.5.3 unless a user specifically asks for daemon-originated VS Code LM runs — it's simpler and keeps the extension genuinely thin.

### V.6 — Webview host hygiene

- [ ] **V.6.1** CSP. Every webview uses the nonce + `default-src 'none'` pattern; remove any `unsafe-inline` that may have crept in.
- [ ] **V.6.2** Message passing. All `postMessage` calls go through Zod-validated schemas shared with the governance-ui package (V.2.1). Reject unknown kinds.
- [ ] **V.6.3** Secret handling. The extension **never** stores provider keys — `ujima.runtime.token` is the only secret, kept in VS Code's `SecretStorage` (not `globalState`).

### V.7 — Commands + contribution-point cleanup

The extension's `package.json` `contributes.commands` lists many in-process commands (`ujima.onboardAgent`, `ujima.addMcp`, etc.). Post-thin-client:

- [ ] **V.7.1** Commands that mutate daemon state (`onboardAgent`, `createTeam`, `addMcp`) become RPC wrappers. Input dialogs stay; handlers forward to SDK calls.
- [ ] **V.7.2** Commands that depend on legacy in-process infra (`loadDemoScenario`, `validateDemoEnv`) get updated to hit the running daemon or get removed if they duplicate `ujima` CLI commands (E5.3).
- [ ] **V.7.3** Drop the "governance panel as primary surface" framing in command titles — channels are primary now. Rename `ujima.openGovernance` → `Ujima: Open Governance Drawer`. Keep the others.

### V.8 — Tests (M5.6)

- [ ] **V.8.1** `@vscode/test-electron` suite: activate with pre-spawned daemon fixture, open Channels view, post a message, receive an agent reply.
- [ ] **V.8.2** Approval flow: trigger a tool that requires approval → approval card renders in the thread → Accept → run resumes → confirmation posts.
- [ ] **V.8.3** Disconnect/reconnect: kill the daemon mid-session → status bar turns red → restart daemon → state resyncs via cold fetch.
- [ ] **V.8.4** Shared fixtures with the daemon integration suite so regressions surface in one place.

### V.9 — What doesn't change

Explicitly preserved to avoid churn:
- `agent-chat-panel`, `activity-stream-panel` rendering code — receives data from SDK instead of in-process calls, otherwise untouched.
- `actions-tree` / `agents-tree` / `mcps-tree` / `teams-tree` — swap data source to SDK; visual/interaction behaviour identical.
- Command IDs (`ujima.newTask`, `ujima.openGovernance`, etc.) — kept stable so user keybindings don't break.
- `esbuild.mjs` + `dist/extension.js` bundling pipeline.

### V — Risks

1. **Losing in-process performance.** Governance IAM toggles are snappy today because they hit a local DB. Over REST + WS expect 50–200ms round trips. Mitigation: optimistic UI on policy toggles, batched bulk edits (matches the evolution-main risk #9).
2. **Daemon auto-spawn races.** Two VS Code windows both auto-starting a daemon on the same `$UJIMA_HOME`. Mitigation: lockfile at `$UJIMA_HOME/daemon.pid`; second window adopts existing pid instead of spawning.
3. **VS Code LM provider decision (V.5).** Relaying LM calls over WS (V.5.2) is architecturally cleaner but a nontrivial shim. V.5.3 is the pragmatic default — revisit if users complain that daemon runs can't use Copilot subscription models.
4. **Legacy session history (V.4.2).** If the daemon has no historical-import endpoint, one-time users lose their in-extension session history. Acceptable — the history is ephemeral diagnostic data, not work product.

---

## X — Cross-cutting (ships alongside E3/E4)

### X.1 — SKILL.md library

Open-standard, file-backed. Phase-1 substitute for the four-layer memory stack.

- [ ] **X.1.1** Skills directory at `<workspace_root>/.ujima/skills/<name>/` with `SKILL.md` + optional scripts/assets.
- [ ] **X.1.2** `ujima skill add <source>` (E5.3.9). Source = git URL or local path. Fetched securely, writes strictly inside the skills directory, rejects any path trying to escape.
- [ ] **X.1.3** Skill-to-member binding via config (`roles.frontendEngineer({ ..., skills: ['react-review'] })`). Dashboard binding deferred.
- [ ] **X.1.4** Execution context. At agent spawn, `SKILL.md` contents compose into the member's system prompt via [buildAgentSystemPrompt](packages/ujima/src/prompts.ts). Custom tool scripts shipped with a skill run under the daemon's policy — constrained to workspace root, subject to approval gates for writes/shell/git.
- [ ] **X.1.5** Per-agent markdown memory at `$UJIMA_HOME/agents/<workspace_id>/<agent_id>/memory/*.md`. The self-channel (E3.2.1) is the primary short-to-medium memory surface; these files are the longer-lived named-topic store.

### X.2 — Escalate tool (X.6a)

Lighter than conflict resolution. No paused siblings, no referee turn.

- [ ] **X.2.1** Internal tool `escalate({ topic, context, hint_role? })` available to every agent. Always allowed.
- [ ] **X.2.2** Routing is an LLM turn. Small `streamText` over `{ topic, context, orgChart, callerRole, callerTeam, hint_role? }` returns `{ target_member_id, audience_channel_id?, rationale }`.
- [ ] **X.2.3** Runtime posts `kind='system'` message in caller's task-run/origin channel: `"{caller} is asking {target} about {topic}"` + DM to target with full context.
- [ ] **X.2.4** `audit.escalation` row with `{caller, target, topic, rationale, chain_id}`. Second escalation with same `chain_id` to previously-seen target posts a notice and stops the chain (loop defence).

### X.3 — Self-note scratchpad (X.7)

Ships with E3.2.

- [ ] **X.3.1** Every agent gets a `kind='self'` channel on spawn. Private — only member + admin (via Audit) can read.
- [ ] **X.3.2** `self.note({ body })` tool — always allowed; ungated.
- [ ] **X.3.3** On every agent turn, the last K self-channel messages (default 20) are prepended to turn context under `## Recent notes`.
- [ ] **X.3.4** `channel.read({ channel_id: 'self', query })` — FTS5 over own notes for recall.
- [ ] **X.3.5** Retired members' self-channels archived but kept indefinitely under the Audit surface.

### X.4 — Intelligence-first catalog

Places the plan defers to an agent turn rather than hardcoding. Removing an item requires an ADR update.

| # | Decision | Fallback |
|---|---|---|
| 1 | Task-channel slug naming (E4.1.1) | Deterministic `task-<short-id>` |
| 2 | Per-agent status summary (E4.1.3) | Step-number string |
| 3 | Task promotion (E4.3.1) | `skip` |
| 4 | Conflict referee — phase 2 (X.6.2 in evolution-main) | Owner DM |
| 5 | Escalate routing (X.2.2) | `hint_role` → direct DM |
| 6 | Self-note recall (X.3.4) | No-op (agent decides) |
| 7 | Memory compaction (E3.2.3) | Manual/none |
| 8 | Supervisor status answer (E4.2.2) | Template using `RunState.summary` (E4.2.9) |

**Hardcoded structural invariants** (never move to LLM): path scope enforcement, approval gate, permission checks, Zod validation, bearer-token checks, TLS on non-loopback, workspace-root gate, **only humans originate tasks**, secret file mode checks, promoter dedupe window.

### X.5 — Schema preservation

- [ ] **X.5.1** Zod schemas in [packages/shared/src/org-schemas.ts](packages/shared/src/org-schemas.ts) are canonical. `ChannelKind` additive extensions (`task-run`, `self`) already landed. `MessageKind` reuses sibling verbatim.
- [ ] **X.5.2** New endpoints use `@ujima/api-schema/additive/` — never mutate sibling shapes.
- [ ] **X.5.3** Breaking a canonical schema (adding a required field, renaming an enum literal) is an ADR event.
- [ ] **X.5.4** Round-trip test: every canonical schema `.parse()`s in the test suite so silent drift breaks loudly.

---

## Deferred (explicitly not in this plan)

Listed so reviewers see they're parked, not dropped:

- **M6** — Next.js dashboard. `apps/web` stays as-is (placeholder).
- **X.6** — Conflict detection + referee (four detector classes, paused siblings). Approval gates + audit cover the phase-1 safety floor.
- **Phase 2** — four-layer memory + dream agent, KAIROS observer, memory driver abstraction, Docker compose self-host, managed cloud skeleton, multi-workspace-per-daemon, marketplace.

Any dashboard-facing payload mentioned in E1–E6 (e.g., `GET /api/runs/:id/detail`, `owner ∈ 'config'|'dashboard'` flags) still ships — the contract exists so M5/M6 can consume it without backend work, even though the UI isn't in scope.

---

## Risks / open questions (backend-scoped subset)

1. **AI SDK lock-in (E0).** Adopting `@ai-sdk/*` deletes a large hand-rolled surface but couples the orchestrator to Vercel's abstraction. Mitigation: the `LanguageModel` boundary is small; `packages/llm/legacy/` is the 90-day escape hatch.
2. **Config vs. DB ownership (E1).** `owner ∈ 'config'|'dashboard'` per field keeps "code wins" as default. Channel messages / audit rows / memory / task runs are never config-owned.
3. **Channel volume (E3.6).** A 10-agent run emits hundreds of messages/hour. 90-day public retention, indefinite `dm|self`, JSONL archive, FTS5, cursor pagination day one. First workspace hitting 10M rows is the signal to invest in partitioning.
4. **Provider fallback character change (E6.3).** Anthropic → OpenAI mid-task changes style. Every fallback writes an audit row; teams wanting no-fallback set `priority:` with a single entry.
5. **Task channel emit volume (E4.1.2).** Batch at turn boundaries; render tool calls as cards, not one message per chunk.
6. **Promoter false positive (E4.3.1).** 10s Cancel window on `promote`; `confirm` is the default for ambiguous; audit trail feeds phase-2 tuning.
7. **Secrets on boot (E6.1.2).** Boot refuses world-readable key files. Add a `ujima doctor` CLI check (E5.3) that catches this before launch.
8. **Deterministic fallbacks everywhere (X.4).** Every LLM-decided step has a hardcoded fallback. An LLM-down day never stalls the user.

---

## First week's work (concrete)

In this order, no parallel:

1. **E0.1.1–E0.1.3** — rewrite `selectProvider` to return `LanguageModel`, port the runner to `streamText`, share tool definitions with orchestrator.
2. **E0.2.1–E0.2.3** — add OpenRouter branch + schema + validator. Single commit after E0.1 is green.
3. **E0.3.1–E0.3.2** — move legacy to `packages/llm/legacy/`, add `orchestrator.engine` config.
4. **E0.4.1–E0.4.4** — tests pass on both engines; CI lint blocks legacy imports outside `legacy/`.

After that, E1 (config reconcile) because every subsequent epic mutates DB state that config would otherwise overwrite.
