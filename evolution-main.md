# Ujima — Evolution (Main)

**Authoritative roadmap as of 2026-04-20.** Supersedes `evolution.md` and `tasks.md` where they conflict.

**Product shape:** Ujima is a local-first control plane for a team of **persistent AI agent members** who collaborate in **channels** and **DMs**, under human **approvals**, inside a hard-sandboxed **workspace root**. Developers define the team in code with `AgentTeam({...})`. The VS Code extension, web dashboard, and CLI are three clients of the same local daemon.

**Task mode is preserved as a first-class feature inside this org model.** A "task run" is a coordinated, wave-scheduled multi-agent run with governance gating, audit, and an activity stream — the existing runtime primitives are not replaced; they become the engine behind "start a task" invoked from a channel, the dashboard, or the CLI.

See [ADR 0002](docs/adr/0002-adopt-ujima-agents-philosophy.md) for the rationale, trade-offs, and what retires. See [docs/merge-plan.md](docs/merge-plan.md) for the file-by-file map of what we port from `ujima-agents-main/apps`.

---

## Which plan do I follow?

- **This document (`evolution-main.md`)** — authoritative going forward. Phase 1 roadmap.
- `evolution.md` — historical. Anything not re-stated here is either shipped (phase 0) or deferred (phase 2+).
- `tasks.md` — historical MVP record. Superseded markers (21.9, 22.6, 26.7, 27.7) carry over.
- `ujima-agents-main/ujima_agents_plan.md` — sibling plan, source of the philosophy. Treat as a reference; this doc is the execution plan.
- When two docs disagree: this one wins.

---

## Design principles

These shape every epic below. When an epic seems to conflict with a principle, the principle wins.

1. **Intelligence-first.** Where both work, prefer an agent turn over hardcoded logic. Structural invariants (auth, approval gates, path scopes, schema validation, permission checks) stay deterministic. Soft decisions (naming, routing, summarisation, conflict refereeing, affinity, team handoff) are LLM-decided. The test: *"could a reasonable agent figure this out?"* — if yes, don't hardcode it.
2. **Channels are the substrate.** Chat, task-run activity, conflict notices, self-thinking, approval prompts, audit summaries all flow through the same `channels` + `messages` primitives. No parallel messaging surfaces. A new feature either rides the channel primitive or justifies in writing why it can't.
3. **Loosely coupled, additive schemas.** The Zod shapes in [`ujima-agents-main/packages/shared/src/schemas.ts`](../ujima-agents-main/packages/shared/src/schemas.ts) (`Organization`, `Member`, `Channel`, `Message`, `ConversationThread`, `ToolCapability`, `ApprovalRequest`, `AuditEvent`, `RunState`, `ToolCall`, `ToolResult`, `ProviderBinding`, `WorkspaceConfig`, `OrganizationChart`) and [`shared/src/events.ts`](../ujima-agents-main/packages/shared/src/events.ts) (`SocketEventNames`, the socket-event schemas) are **preserved verbatim** as the canonical base. `@ujima/api-schema` stays **additive**: workspace DTO, task DTO, event-subscribe query, WS frame — these extend the base; they don't rewrite it. A breaking change to a sibling schema is a new-ADR-required event, not a routine edit.
4. **Agents are persistent members, not task-scoped actors.** An agent has identity, presence, DM threads, a self-channel, and memory that survives any single run. Task runs are an *action* a team of members can take, not a spawn + teardown cycle.
5. **One workspace root per org, hard-sandboxed.** Every filesystem / shell / git / MCP-path operation resolves through `PathResolver` and rejects on escape. Per-role subpath restrictions layer on top.
6. **Secrets stay in the daemon.** Providers, tokens, SKILL.md scripts execute under the daemon's policy. The extension and browser never hold provider keys.
7. **Local-first, single-owner, phase-1.** SQLite, no multi-tenant tables, no OIDC. Cloud is a decision-gated phase-2 concern.
8. **Open standards only.** SKILL.md for skills. MCP for external tools. No proprietary memory vendors. No vendor lock-in on durable state.
9. **The UI is an operating surface, not the source of truth.** `ujima.config.ts` owns config; the dashboard + plugin edit live state and observe config-owned fields.

---

## Phase 0 — Shipped foundations (frozen; do not re-plan)

| Area | State | Where |
| --- | --- | --- |
| MVP runtime (SQLite + event bus + permission middleware + MCP pool + orchestrator wave scheduler) | Shipped | Epics 1–10 of `tasks.md` |
| VS Code governance panel (IAM matrix, activity stream, approval gates, session history) | Shipped | Epic 11 subset |
| **Epic 12 — Runtime extracted to `apps/runtime` daemon** (`runtime-core`, `$UJIMA_HOME`, WorkspaceFS, PathResolver, WorkspaceStore, graceful shutdown, dirty-flag recovery) | **Shipped** | [apps/runtime/](apps/runtime/), [packages/runtime-core/](packages/runtime-core/) |
| **Epic 13 — Transport layer** (Fastify + socket.io, bearer-token auth, loopback-only / TLS gate, per-client backpressure, `@ujima/api-schema`, `@ujima/client-sdk`) | **Shipped** | [apps/runtime/src/transport/](apps/runtime/src/transport/), [packages/api-schema/](packages/api-schema/), [packages/client-sdk/](packages/client-sdk/) |
| Deferred in place: 13.7 rate limit (waits on `@ujima/permissions` sliding-window primitive), 13.2 `POST /agents` / `/mcps` / `/audit` / `/governance/*` (wait on Phase 1 surfaces) | Deferred | — |

**No further work is planned against Epic 12 or 13 in phase 1 except the deferred bits, which land naturally as dependent surfaces arrive.**

---

## Phase 1 — Org-first product (this document)

Seven milestones. Rough order:

| Milestone | Title | Ships | Depends on |
|] --- | --- | --- | --- |
| **M1** | AgentTeam framework + AI SDK orchestration + org/member schema | `packages/ujima`, `AgentTeam({...})`, `@ai-sdk/*` replaces `@ujima/llm` clients, `orgs`/`org_members`/`workspace_members` tables | Phase 0 |
| **M2** | Channels, DMs, `@mentions` | `channels`/`messages`/`message_mentions` tables, `channel.*` internal tools, WS frames, thread-as-activity-stream for task runs | M1 |
| **M3** | Task-mode polish inside the org shell | Slim mode engine + YAML task file + per-stage checkpoints; task runs spawn a thread in the originating channel | M2 |
| **M4** | CLI `ujima init` + bootstrap | `apps/cli`, one-command first-run (pick workspace root, scaffold `ujima.config.ts`, generate token, launch daemon, open dashboard) | M1 |
| **M5** | Thin-client VS Code plugin (channels-first) | Plugin connects to daemon, renders channels/DMs/threads, proxies approvals, retains activity panel | M2 |
| **M6** | Next.js dashboard (channels-first) | `apps/dashboard` with shadcn + AI SDK UI, three-pane channels layout, Members / Workspaces / Providers pages, governance surfaces | M2 |
| **M7** | Multi-provider BYOK + hardening | `providers`/`provider_bindings` tables, Dashboard Providers page, CLI parity, secret store `$UJIMA_HOME/secrets/*` at `0600`, threat-model doc, path-scope wire-up at MCP boundaries | M1 + M3 |

Decision gate at the end of M7: ship, gather usage, then decide whether phase 2 (four-layer memory / cloud / KAIROS / conflict detection) starts.

---

## M1 — AgentTeam framework, AI SDK orchestration, org/member schema

The foundation for everything that follows. This is where we stop hand-rolling provider clients and tool loops, where `ujima.config.ts` becomes the source of truth, and where "agent" stops meaning "task-scoped actor" and starts meaning "persistent org member".

### M1.1 — `packages/ujima` public framework

- [ ] **M1.1.1** Create `packages/ujima` with single-entrypoint public API:
  ```ts
  import { AgentTeam, roles, secret } from 'ujima';
  export default AgentTeam({
    org: 'acme',
    workspace: { root: '/abs/path', roleScopes: { 'frontend-engineer': ['apps/web'] } },
    providers: [ { id: 'anthropic', kind: 'anthropic', apiKey: secret('ANTHROPIC_API_KEY'), defaultModel: 'claude-opus-4-7' } ],
    roles: [ /* template overrides */ ],
    agents: [
      roles.frontendEngineer({ name: 'Alex',  provider: 'anthropic' }),
      roles.codeReviewer({ name: 'Quinn', provider: 'anthropic' }),
    ],
    channels: ['general', 'frontend'],
    policies: { requireApprovalForWrites: true, requireApprovalForShell: true },
  });
  ```
- [ ] **M1.1.2** `roles.*` preset helpers: `frontendEngineer`, `backendEngineer`, `pm`, `codeReviewer`, `engineeringManager`, `qaEngineer`. Each returns a typed partial with persona + default MCP pairing + default governance rows. Matches the `PERSONA_TEMPLATES` roster in `@ujima/shared`.
- [ ] **M1.1.3** `personality.*` presets: `direct`, `thorough`, `skeptical`. Affects the system-prompt tail; no behaviour change to the tool loop.
- [ ] **M1.1.4** `secret('ENV_NAME')` helper — Zod refuses raw strings in `apiKey`-shaped fields at load time, so a committed `ujima.config.ts` cannot leak a key.
- [ ] **M1.1.5** `AgentTeam.fromFiles({ agentsDir, teamsDir })` — reads the existing `examples/demo/agents/*.json` + `examples/demo/teams/*.json` layout and returns a `TeamConfig`. Keeps fixtures working.
- [ ] **M1.1.6** Zod schema for `TeamConfig`. `ujima config validate` dry-run reconcile lands in M4.

### M1.2 — Config discovery + reconcile loop

- [ ] **M1.2.1** Daemon resolves `UJIMA_TEAM_CONFIG` env → `ujima.config.ts` → `ujima.config.js` at workspace root. File watcher triggers reconcile on save.
- [ ] **M1.2.2** Reconcile loop diffs `TeamConfig` against DB and applies config as authority for config-owned fields. Never drops non-config state (channel messages, audit rows, memory entries).
- [ ] **M1.2.3** Per-field `owner ∈ 'config'|'dashboard'` flag on config-managed rows. Dashboard edits to `owner='config'` fields apply as advisory overrides unless `allowDashboardOverride: true` on the field.
- [ ] **M1.2.4** Dashboard banner "Managed by ujima.config.ts · Edit in code" links to the file:line of the relevant config section.

### M1.3 — AI SDK orchestration (ADR 0001 execution)

- [ ] **M1.3.1** Replace `@ujima/llm` provider clients with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`. `LLMClient` becomes a thin adapter returning a SDK `LanguageModel`.
- [ ] **M1.3.2** Rewrite [packages/orchestrator/src/tool-loop.ts](packages/orchestrator/src/tool-loop.ts) on top of `streamText({ model, tools, stopWhen, maxSteps })`. Every current Ujima tool (MCP calls + internal `memory.*` / `channel.*` / `log.*` tools when they arrive) registered via SDK `tool({ description, parameters, execute })`.
- [ ] **M1.3.3** **Wave scheduling stays in the orchestrator.** `runTask` + `plan.ts` + the wave loop remain ours; AI SDK only handles the inner single-agent turn. Governance gating, conflict detection hooks, memory all run *between* `streamText` calls.
- [ ] **M1.3.4** Governance gate as an AI SDK tool pre-hook. The `execute` wrapper runs `@ujima/permissions` first; a blocked call returns a structured error that the LLM reads, matching how today's loop surfaces deny rows.
- [ ] **M1.3.5** Streaming surface — expose AI SDK data streams directly over the WS channel (`data.frame` events). Dashboard + plugin consume via `@ai-sdk/react`'s `useChat`.
- [ ] **M1.3.6** Legacy fallback. `packages/llm/legacy/` pins the current provider clients. Runtime config `orchestrator.engine = 'ai-sdk'|'legacy'` (default `ai-sdk`). Delete `legacy/` two clean releases after cutover.
- [ ] **M1.3.7** Cost + OTel parity. Cost meter reads AI SDK `usage`. OTel spans wrap `streamText` call boundaries.

### M1.4 — Org + member schema

- [ ] **M1.4.1** Schema migration `003_org_members`. Row shapes are the Drizzle mapping of the sibling-repo Zod schemas in [`ujima-agents-main/packages/shared/src/schemas.ts`](../ujima-agents-main/packages/shared/src/schemas.ts); additive columns are ours:
  - `orgs(id, name, slug, created_at)` — maps `OrganizationSchema` + `organizationChart` JSON.
  - `org_members(id, org_id, kind, display_name, email?, agent_template_id?, presence, created_at)` where `kind ∈ human|agent` — maps `MemberSchema` with `presence` ∈ `PresenceStateSchema` (`online|offline|busy|away`).
  - `workspace_members(id, workspace_id, member_id, role_name, role_scope_paths JSONB, joined_at, last_seen_at, retired_at)` — `role_scope_paths` is our additive column carrying the sibling's `RoleScopesSchema` per-member subset.
  - `agent_templates(id, name, persona, instructions, default_tools JSONB, seniority)` — superset of today's `PERSONA_TEMPLATES`; `default_tools` is an array of `ToolCapabilitySchema` entries from the sibling schemas.
  - `provider_bindings(id, workspace_member_id, provider_id, priority, model_override)` — maps `ProviderBindingSchema`; provider table itself lands in M7.
- [ ] **M1.4.2** Migration from current seed files. Existing `examples/demo/agents/*.json` + `examples/demo/teams/demo-team.json` materialise one `org` + one `workspace` + one `workspace_member` per agent on first boot.
- [ ] **M1.4.3** Presence. Every agent turn + every dashboard WS connect bumps `workspace_members.last_seen_at`. WS event `member.presence.changed` drives the dashboard Members list.
- [ ] **M1.4.4** Retirement vs. hard delete. `retired_at` removes from rotation without dropping history; hard delete is admin-only and leaves a tombstone so audit references don't dangle.
- [ ] **M1.4.5** REST surface additions (extending Epic 13.2): `GET /orgs`, `GET /orgs/:id/members`, `POST /orgs/:id/members`, `PATCH /workspace_members/:id`, `DELETE /workspace_members/:id` (retire, not hard delete).
- [ ] **M1.4.6** Client SDK additions in `@ujima/client-sdk` for all of the above.

### M1.5 — Single workspace root hardening (closes 12.9a/b/c)

- [ ] **M1.5.1** First-run gate at the REST surface: any task / member / channel mutation before a workspace's `root_path` is set returns `ERR_NO_WORKSPACE_ROOT`. UX surfaces (dashboard / extension onboarding / CLI `ujima init`) land with M4/M5/M6.
- [ ] **M1.5.2** Wire `PathResolver` at **every daemon-internal FS boundary**: MCP args that name paths, WorkspaceFS reads/writes, audit log path fields. Reject on escape with `ERR_PATH_ESCAPE`.
- [ ] **M1.5.3** Per-role subpath enforcement — `workspace_members.role_scope_paths` constrains a member's resolver to an allowlist inside the workspace root (e.g. `frontend-engineer` → `apps/web`). Closes Epic 12.9b.
- [ ] **M1.5.4** Tests: traversal rejection, symlink escape, role-scope enforcement, seed-file migration produces expected `org_members` rows.

---

## M2 — Channels, DMs, `@mentions`

Once members are persistent (M1), they need a **messaging surface**. This milestone ships the durable chat layer and binds task runs to channel threads so ambient chat and structured runs share the same history.

### M2.1 — Messaging schema (aligned with sibling `shared/schemas.ts`)

- [ ] **M2.1.1** Schema migration `004_channels`. `kind` values match [`ChannelKindSchema`](../ujima-agents-main/packages/shared/src/schemas.ts) (`general | group | dm`); our additive kinds are `task-run` and `self`:
  - `channels(id, org_id, workspace_id, name, kind, topic, parent_message_id?, created_by, created_at)` where `kind ∈ general | group | dm | task-run | self`. `general` and `group` are public to the org; `dm` is a 2-member channel; `task-run` is a channel auto-created per task (see M3.1); `self` is a private per-member scratchpad (see M2.2.3).
  - `conversation_threads(id, org_id, channel_id?, member_ids JSONB, title, created_at)` — maps `ConversationThreadSchema` verbatim. Used for sub-threads inside a channel; task runs live on `channels.kind='task-run'`, not here.
  - `channel_memberships(id, channel_id, member_id, role, joined_at)` roles: `member | admin | observer` (observer = read-only).
  - `messages(id, org_id, channel_id, thread_id?, author_id, kind, body, reply_to, mentions JSONB, created_at, edited_at?, deleted_at?)` where `kind` maps `MessageKindSchema` (`human | agent | system`). `system` covers "X joined", "run started", "approval requested", conflict notices, etc. The `mentions` column is a JSON array of member ids matching the sibling `Message.mentions` field.
  - `message_mentions(id, message_id, member_id, kind)` kinds: `mention | assignment | fyi` — ours; extends the sibling's flat `Message.mentions` array with typed intent.
  - Indexes: `messages(channel_id, created_at DESC)` for wall pagination, `messages(author_id, created_at)` for per-member timelines, FTS5 virtual table `messages_fts(body, content=messages)` for search (M2.5).

### M2.2 — Default channels, auto-join, self-channels

- [ ] **M2.2.1** `ujima init` (M4) creates `#general` (`kind='general'`) plus one `group` channel per enabled preset role (`#frontend-engineers`, `#backend-engineers`, etc.). A new agent member joining a workspace is auto-added to `#general` + its role's group channel.
- [ ] **M2.2.2** Config-declared channels from `AgentTeam({ channels: [...] })` materialise on reconcile (M1.2). Removing a channel from config **archives** it (sets `archived_at`); it never hard-deletes messages.
- [ ] **M2.2.3** **Self-channel per agent member** (`kind='self'`). Created on member spawn; invisible to everyone except the member itself. This is the agent's scratchpad — where it thinks out loud, jots plans, drafts before posting to public channels, and consumes its own prior notes on the next turn. UI: not listed in the left sidebar's Channels section; surfaced under the member's own avatar menu ("My notes"). The human admin can view any self-channel via the Audit surface, but agents cannot peek into other agents' self-channels.
- [ ] **M2.2.4** Self-channel retention is **indefinite** by default (override `memory.self_retention_days` in config). Self-channel messages are part of the agent's durable memory surface; compacting is an opt-in per-agent action (an LLM summarisation pass that replaces oldest N messages with a `kind='system'` summary message, per principle #1).

### M2.3 — WS frames + internal tools

- [ ] **M2.3.1** WS frames. Our `@ujima/api-schema` adds frame kinds that wrap the sibling socket-event schemas from [`shared/src/events.ts`](../ujima-agents-main/packages/shared/src/events.ts) — `channel:message`, `channel:presence`, `thread:message`, `dm:message`, `approval:requested`, `approval:resolved`, `run:started`, `run:updated`, `run:completed`, `member:updated`, `tool:called`, `tool:result`. Our additive frames: `member.alerted`, `conflict.raised`, `conflict.resolved`, `channel.archived`. All persisted in `pending_events` for replay.
- [ ] **M2.3.2** Privileged internal tools (bypassing MCP) exposed to every agent member:
  - `channel.post({ channel_id, body, reply_to? })`
  - `channel.reply({ message_id, body })`
  - `channel.dm({ member_id, body })` — creates DM lazily on first send. `member_id` may be `self` → routes to the agent's own self-channel (equivalent to `channel.post({ channel_id: self.channel_id })`, but ergonomic).
  - `channel.list({ scope: 'mine' | 'all' })`
  - `channel.read({ channel_id, since? })` — paginated, cursor from M2.5.2.
  - `self.note({ body })` — shorthand for "post to my self-channel". Primary ergonomic API for agent thinking-out-loud (principle #1).
  - `escalate({ topic, context, hint_role? })` — asks a senior for a decision via org-chart-aware LLM routing (X.6a). Always allowed.
- [ ] **M2.3.3** Governance. IAM matrix gains a `channels` pseudo-MCP so policy rows can gate `junior-qa → channel.dm(senior-*)`. `@mentions` bypass the governance gate — alerts can't be silenced by permissions; only by member-level mute preferences. `self.note` is **always allowed** (an agent cannot be denied the ability to think to itself; denying it would break principle #1).

### M2.4 — `@mention` fan-out

- [ ] **M2.4.1** On message post, the runtime parses `@<display_name>` and for each resolved member emits `member.alerted` with `{ reason: 'mention' | 'assignment' | 'fyi', channel_id, message_id, by_member_id }`.
- [ ] **M2.4.2** Agent members wake up on `member.alerted` and add the mentioning message + recent channel context (last 20 messages or since the agent's last read, whichever is smaller) to their next turn. Dormant-by-default — an agent not `@mentioned` and not in an active task run does not run.
- [ ] **M2.4.3** Human members get a dashboard notification + optional email (`notifications.email = true` on `org_members`).
- [ ] **M2.4.4** **Mention-storm rate limit.** An agent can trigger at most 10 distinct `@mention` fan-outs per minute per org. Beyond that, mentions by that agent queue with a `member.alert_throttled` system message posted to `#general` — loop defence. Reuses the sliding-window primitive from M7.4.5.
- [ ] **M2.4.5** **Self-mentions don't re-wake.** `@<self>` in a message authored by the same agent does not trigger a fresh turn; it's logged but suppressed — an agent can note its own thinking without triggering a reentrant turn.

### M2.5 — Retention + scale

- [ ] **M2.5.1** `messages` retention default 90 days for `general|group|task-run` kinds; **indefinite** for `dm|self` (personal/private records). Archived public messages land at `$UJIMA_HOME/archives/channels/<channel_id>/<YYYY-MM>.jsonl` but stay queryable via FTS5 over the archive index.
- [ ] **M2.5.2** Cursor-based pagination from day one (cursor = `created_at|id` tuple). Matches sibling `PaginationQuerySchema`.
- [ ] **M2.5.3** Edited / deleted messages use tombstones (`edited_at`, `deleted_at`) — history is append-only; a "deleted" message renders as `"[deleted]"` in the client; the underlying row stays for audit. Only the original author + admins can edit / delete. Tool-call cards inside a message render from `tool_calls` JSON; editing the prose never rewrites the tool-call record.

### M2.6 — Tests

- [ ] **M2.6.1** Covered scenarios:
  - Post → `@mention` → agent wakes → reply lands in the same channel.
  - DM lazy-creates the channel on first send; second send reuses.
  - Self-channel is created on member spawn; `self.note(body)` appends; other members cannot `channel.read` it.
  - Un-mentioned agents do not react to a message in a channel they're a member of.
  - Mention storm: 11th mention in 60s queues and emits `member.alert_throttled`.
  - Self-mention does not re-wake.
  - Retention job moves rows to archive; FTS5 search still hits archived rows.
  - Edit + delete leave tombstones; tool-call cards in the original message still render.
  - Config drops a channel → channel is archived, messages preserved.
  - Retired member's past messages still render with the display name captured at message time (see M1.4.4).

---

## M3 — Task mode inside the org shell

The existing task-mode runtime (wave scheduler, governance, audit, approval gates, slim mode, activity stream) stays load-bearing. What changes in M3: **every task run is a channel** (`kind='task-run'`) that members join, not a thread on a parent channel. This matches the target UI — `#task-auth-redesign` in the sidebar sits next to `#general` and `#task-db-migration`, each with its own unread state and activity pane.

### M3.1 — Task run as a channel

- [ ] **M3.1.1** On `POST /tasks`, the runtime:
  1. Generates a slug (`task-<kebab-of-prompt>-<short-id>`, e.g. `task-auth-redesign-4f7`). Slug generation uses the LLM with a 1-token-bounded prompt for descriptive naming, falling back to the short-id prefix on timeout (principle #1).
  2. Creates a channel `#<slug>` with `kind='task-run'`, auto-adds the task's team members + the invoking human as memberships.
  3. Stores `channels.task_run_id = <run id>` so the channel ↔ run mapping is explicit.
  4. Emits a `kind='system'` message: `"{member_names} joined"` matching the screenshot's "senior-engineer and junior-engineer joined" row.
  5. Optional `origin: { channel_id, message_id? }` on the request posts a link-back message in the origin channel: `"Started #<slug> — follow along"`. The origin channel stays the ambient surface; the task-run channel is where the run lives.
- [ ] **M3.1.2** Per-turn agent output streams as `kind='agent'` messages in the task-run channel. Tool-call cards (`read_file`, `search_codebase`, `write_file`, etc.) render inline inside the message they belong to, sourced from a per-message `tool_calls` JSONB column populated from the sibling `ToolCallSchema` + `ToolResultSchema`. Batching: at turn boundaries, not per-token. Progress UI (the yellow progress bar in the screenshot) is driven by `RunStateSchema.step` + `summary`.
- [ ] **M3.1.3** Task run drawer state (the right pane in the screenshot) is derived from a single payload: `GET /runs/:id/detail` returns `{ run: RunState, activeAgents: [{member_id, status_label}], tokens: { per_member_id: number }, tools: { tool_name: { count, pending } } }`. Pushed as `run:updated` with that payload; dashboard + plugin render identically.
- [ ] **M3.1.4** Approval prompts render as `kind='system'` messages in the task-run channel carrying an embedded `ApprovalRequestSchema` payload. Accept / reject UI is a shadcn `Card` with two buttons inside the message; resolving it emits `approval:resolved` and replaces the card with the outcome. Same primitive used in DM (when an agent DMs a human for approval) and in `#general` conflict notices (see X.6).
- [ ] **M3.1.5** Task completion posts a summary message (`kind='system'`) in the task-run channel and a link-back in `#general` + the origin channel. Failure posts a red-tinted summary with the failure reason. The task-run channel stays — it's the durable record of the run, searchable via FTS5.
- [ ] **M3.1.6** Task run archival: completed task-run channels are **not** archived by default (they're the audit log in narrative form); an admin can archive any task-run channel to hide it from the sidebar.

### M3.1.7 — Supervisor + worker split (keeps agents responsive mid-run)

Each persistent agent member has two execution modes sharing the same identity, memory, and self-channel. This is what makes "DM Alex during a task run to ask 'how's it going?'" actually work without blocking the run.

- [ ] **M3.1.7.1** **Worker loop.** The `streamText` invocation that runs inside a task-run wave. Owns the task-run channel output, tool calls, approval-gate prompts, and `RunState` updates. One worker per agent per active run. This is the existing [M1.3.2](evolution-main.md#L109) path with no behavioural change.
- [ ] **M3.1.7.2** **Supervisor loop — lazy, spun up on DM or `@mention` only.** When a `member.alerted` frame fires for an agent that currently has a live worker, the runtime starts a *separate* lightweight `streamText` call with a small context: `{ recentTaskRunMessages: last 20, selfNotes: top-K by recency, runState: { step, summary, activeTool }, alert: { reason, channel_id, message_id, by_member_id } }`. It answers in the channel/DM where the alert originated, then exits. Never spawned speculatively; no supervisor if no alert.
- [ ] **M3.1.7.3** **Model tier.** Supervisor defaults to the cheaper model on the agent's `provider_bindings` fallback list (M7.1 / M7.3.1) — `claude-haiku-4-5-20251001` when the worker runs on `claude-opus-4-7`. Override per agent via `roles.*({ supervisorModel })`. Rationale: status answers don't need the worker's reasoning depth.
- [ ] **M3.1.7.4** **Shared state.** Supervisor and worker both read the agent's self-channel. Supervisor **may write** to the self-channel (`self.note`) so worker's next turn sees "user asked about progress at 14:02 and I told them X" — keeps answers consistent if asked twice. Supervisor **never** calls write/shell/git tools, never posts to the task-run channel itself. Enforced in the tool allowlist: supervisor gets `channel.post (author DM/mention origin only)`, `channel.read`, `self.note`, nothing else.
- [ ] **M3.1.7.5** **Todo-list primitive.** Add `supervisor.todo.*` internal tools — `add({body})`, `check({id})`, `list()` — backed by a per-agent `todos` table (`id, member_id, body, state ∈ open|done|cancelled, run_id?, created_at, resolved_at?`). Worker can `todo.check` at the end of a wave it satisfied; supervisor can `todo.add` from a DM ("also please check X"). Renders in the run drawer's context pane (M6.3) and in the member profile.
- [ ] **M3.1.7.6** **Concurrency & ordering.** Worker turns are serialized per agent (wave scheduler). Supervisor turns run in parallel with worker turns but are also serialized among themselves (one DM at a time per agent) — simple mutex keyed on `member_id + 'supervisor'`. If a DM arrives while a supervisor turn is already running, it queues with a 2s debounce so rapid follow-up questions coalesce into one context.
- [ ] **M3.1.7.7** **Idle agents.** If the agent has no live worker (not in any task run), a DM/`@mention` wakes the **regular** loop (M2.4.2) — no split needed. Supervisor is strictly the "worker is busy" fast-path; there's no separate supervisor process lurking.
- [ ] **M3.1.7.8** **Cost control.** Supervisor calls count toward the agent's per-run token budget (M7.4.4) under a `kind: 'supervisor'` tag so the dashboard can break out "supervisor tokens" separately in the run drawer (M6.3.3). Per-run cap default 10 supervisor turns; beyond that, DMs queue an auto-reply pointing at the task-run channel.
- [ ] **M3.1.7.9** **Deterministic fallback (principle #1).** If the supervisor call fails (provider timeout, budget exhausted, tool error), the runtime posts a terse auto-reply sourced from `RunState.summary` + the last worker message: `"Currently on step {step_n} of task {run_slug} — last action: {RunState.summary}. Full activity in #{task_run_channel}."` Never leaves the user hanging.
- [ ] **M3.1.7.10** **Code reuse.** `packages/ujima` config surface from `ujima-agents-main` (`AgentTeam`, `AgentConfig`, `RoleConfig`, `normalizeAgentTeamConfig`, `createAgent`) is preserved verbatim — the supervisor is not a new member type, it's a second execution mode of the same `AgentConfig`. Sibling `ToolCapabilitySchema` carries the new `supervisor.todo.*` entries as additive tools. No sibling schema is modified (per X.9).
- [ ] **M3.1.7.11** Tests:
  - DM an agent mid-run → supervisor responds within 2s; worker tool-call cadence unchanged.
  - Ask "what's your todo list?" → supervisor returns `todo.list()`; matches DB state.
  - Worker completes a wave satisfying a todo → `todo.check` marks it done → next supervisor reply reflects the change.
  - Supervisor cannot call `write_file` (tool allowlist blocks; structured error to the LLM).
  - 11th supervisor call in one run → auto-reply with task-run link, no provider hit.
  - Provider fails mid-supervisor-turn → fallback template reply posts; audit row `supervisor.fallback`.

### M3.2 — Task invocation (AI-decided, not human-invoked)

No "Run as task" button. Whether a message *is* a task is itself an agent decision (principle #1). The runtime evaluates every human message in a public/group channel and the system — not the human — spins up the task-run channel.

- [ ] **M3.2.1** **Task-promoter hook.** On every `kind='human'` message in `general | group` channels (not DMs, not `self`, not `task-run`), the runtime fires a small `streamText` call with: `{ message, recentChannelMessages: 10, orgChart: OrganizationChartSchema, roles: AgentConfig[], activeRuns: [{slug, summary}], channelName }`. Returns `{ decision: 'promote' | 'confirm' | 'skip', confidence, team?: string[], execution_mode?: 'concurrent'|'slim', slug_hint?: string, rationale }`.
  - `promote` (confidence ≥ 0.8): runtime auto-creates the task-run channel with `team` + `execution_mode`, posts a `kind='system'` card in the origin channel: `"Running this as a task → #{slug} · Cancel within 10s"`. The cancel window is a plain button that aborts the fresh run before the first wave.
  - `confirm` (0.5 ≤ confidence < 0.8): posts a `kind='system'` card `"Should I run this as a task with @{team}? · Yes · No · Edit team"`. No task created unless the user clicks Yes. Times out to "No" after 60s with no action.
  - `skip` (< 0.5): does nothing. Message posts normally.
- [ ] **M3.2.2** Slash command `/task run [<team>] <prompt>` stays as the **explicit power-user fallback** in any channel. Bypasses the promoter. Useful when the human wants to force a task the promoter would skip, or wants to pin the team selection.
- [ ] **M3.2.3** CLI `ujima task run` (M4.3.1) gains optional `--channel <id>` to origin-tag the run, and prints the task-run channel URL on start. Unchanged.
- [ ] **M3.2.4** **Team `@mentions`.** `@code-review-team` in a channel message by a human routes through the promoter with `team_hint = 'code-review-team'` — the promoter heavily weights the hint but still decides `promote | confirm | skip` based on whether the *content* actually asks for coordinated work. Agent-authored `@mentions` of a team wake the team members individually (M2.4.1) and never auto-promote (structural invariant — only humans can originate a task, per principle 8's hardcoded-invariants list).
- [ ] **M3.2.5** **Auditability.** Every promoter decision writes an `audit.task_promoter` row with `{decision, confidence, team, rationale, message_id}`, surfaced in the Audit drawer with a "recent decisions" filter. Humans can correct a promoter decision ("no this wasn't a task") — corrections feed a follow-up fine-tune / few-shot prompt adjustment in phase 2.
- [ ] **M3.2.6** **Deterministic fallback (principle #1).** If the promoter LLM call fails (timeout, budget exhausted, parse error), the runtime defaults to `skip`. The message posts normally and the user can always use `/task run` explicitly. Never stall the channel on the promoter.
- [ ] **M3.2.7** **Rate-limit + dedupe.** Promoter runs at most once per message, and at most once every 3s in a given channel (sliding window). Repeated near-identical messages within 60s share a single decision to avoid spawning duplicate runs from a typo-retry.

### M3.3 — Slim mode + task YAML

- [ ] **M3.3.1** Slim mode execution engine. `runSlim(deps, { members, sequence })` runs agents sequentially, passing prior output + browser-state snapshot into the next prompt using the existing formatter at [packages/orchestrator/src/run-task.ts:432](packages/orchestrator/src/run-task.ts#L432).
- [ ] **M3.3.2** YAML task file. Schema: `task_id`, `prompt`, `team`, `execution_mode`, `approvals.mode`, optional `graph` for slim-mode sequencing. Validated with the Zod schema from `@ujima/api-schema`.
- [ ] **M3.3.3** Per-stage checkpointing. `context.put('task:<id>:slim:checkpoint:<stage>', state)` between stages so restart resumes from the last completed stage.
- [ ] **M3.3.4** Mark `tasks.md` 5.5, 11.2, 11.11 as superseded-by-M3.3.

### M3.4 — Tests

- [ ] **M3.4.1** Run task with `origin.channel_id` → thread created → activity events land as thread messages → summary posts to parent channel. Slim run, middle stage killed, restart resumes from the last checkpoint. Approval gate triggers a gate message in the thread with accept/reject affordances.

---

## M4 — CLI `ujima init` + bootstrap

The command `README` points at for first-run. Zero-to-running in one invocation.

### M4.1 — Scaffold `apps/cli`

- [ ] **M4.1.1** `apps/cli` with `commander`. Distributed as `@ujima/cli` + `ujima` bin.

### M4.2 — `ujima init`

- [ ] **M4.2.1** Interactive prompts: organization name → organization root folder (must exist) → pick preset roles (multi-select from M1.1.2 roster) → provider keys (skip to configure later).
- [ ] **M4.2.2** Writes `workspaces(root_path)` via the daemon, scaffolds a starter `ujima.config.ts` with the chosen roles + a single `#general` channel, generates `$UJIMA_HOME/config.json` + daemon token (writes to `0600`).
- [ ] **M4.2.3** Launches the daemon (`ujima daemon start`), opens the dashboard URL in the browser.

### M4.3 — Core commands

- [ ] **M4.3.1** `ujima task run <task-file.yaml>` — start a task, stream events to stdout (NDJSON when not a TTY), exit on terminal state.
- [ ] **M4.3.2** `ujima task list`, `ujima task show <id>`.
- [ ] **M4.3.3** `ujima agent list`, `ujima agent add <def.json>` (M1 shapes).
- [ ] **M4.3.4** `ujima gate list`, `ujima gate approve <id>`, `ujima gate reject <id>`.
- [ ] **M4.3.5** `ujima audit tail -f [--agent ...] [--tool ...]`.
- [ ] **M4.3.6** `ujima policy set <agent> <mcp> <tool> <state>` — cycle IAM states.
- [ ] **M4.3.7** `ujima daemon start|stop|status`.
- [ ] **M4.3.8** `ujima config validate` (M1.1.6) — Zod validation + dangling-reference check + dry-run reconcile diff.
- [ ] **M4.3.9** `ujima skill add <source>` — installs SKILL.md into `<workspace_root>/.ujima/skills/<name>/`. Source is a git URL or local path; fetched into place, then surfaced in the framework's skill loader.

### M4.4 — Exit codes + tests

- [ ] **M4.4.1** Exit codes: `0` success, `1` failed agent, `2` approval pending at timeout, `3` session killed, `>=64` usage errors.
- [ ] **M4.4.2** Shellcheck-style integration suite spawns a daemon fixture and exercises every command.

---

## M5 — Thin-client VS Code plugin (channels-first)

The plugin becomes a UI shell that connects to the daemon over `@ujima/client-sdk`. The governance panel stays, but channels are the new primary surface.

### M5.1 — Connection + lifecycle

- [ ] **M5.1.1** Strip `TaskRunner.ensureInfra` (plugin-side) down to a stub that connects the SDK to `ujima.runtime.url` (default `http://127.0.0.1:7511`). Auto-spawn a local daemon if `ujima.runtime.autoStart` is true and nothing is reachable.
- [ ] **M5.1.2** Local-daemon process management. If auto-start, spawn `node dist/runtime/main.js` as a detached child at activation; write pid to `$UJIMA_HOME/daemon.pid`; reap stale pids on reconnect.
- [ ] **M5.1.3** Status-bar health indicator — green (ok), yellow (reconnecting), red (disconnected). Click → QuickPick: Start daemon / Configure URL / View logs.

### M5.2 — Channels view

- [ ] **M5.2.1** New activity-bar view "Channels". Tree: workspace → channels → DMs → threads. Selecting a channel opens a webview message list.
- [ ] **M5.2.2** Message composer with `@mention` autocomplete (fetches `org_members` on open).
- [ ] **M5.2.3** Thread view renders task-run activity inline — reuses the AI SDK UI components from M3.1.2.

### M5.3 — Governance panel stays

- [ ] **M5.3.1** `apps/webview/src/Governance.tsx` moves into a new `packages/governance-ui` package. Both the plugin's webview and the dashboard (M6) consume it.
- [ ] **M5.3.2** Handlers now forward to the SDK instead of local objects. The webview message surface (`HostToWebviewMessage` / `WebviewToHostMessage`) keeps its shapes; only the handler guts change.

### M5.4 — State as view model

- [ ] **M5.4.1** Rewrite `SessionController` as a view model over the SDK's WS event stream. No authoritative state lives in the plugin anymore. Re-renders on every event.

### M5.5 — Session history migration

- [ ] **M5.5.1** Migrate `context.globalState.ujima.sessions.history` to read from the daemon (`GET /tasks`). Keep a local read-through cache for quick startup.

### M5.6 — Tests

- [ ] **M5.6.1** `@vscode/test-electron` suite: activate with pre-spawned daemon fixture, open Channels view, post a message, run the demo scenario end-to-end. Shares fixtures with the daemon integration tests.

---

## M6 — Next.js dashboard (channels-first)

Same API, different surface. **Not** "the governance panel in a browser" — a Slack-like workspace app with governance as a drawer. The target visual is the reference screenshot: three panes, task runs rendered as channels, a run-detail pane on the right with per-agent token meters and per-tool counts, and a unified composer that hosts `@mentions` + slash commands.

> **Note:** M6 is not on the immediate work queue — M1/M2/M3/M4 ship first, then M5 (plugin) and M6 (dashboard) land together as the two client surfaces. These tasks exist so the contract between runtime (`run:updated` payloads, `channels.kind='task-run'`, mention shape, etc.) is known while the backend is built.

### M6.1 — Shell + navigation

- [ ] **M6.1.1** Next.js 15 (App Router) + Tailwind + shadcn/ui primitives + `@ai-sdk/react` for streaming chat/activity. Single-page app; SDK is client-side.
- [ ] **M6.1.2** Three-pane layout (shadcn `Sidebar` + `ResizablePanelGroup`):
  - **Left:** app header (org name + avatar initial), "Channels" section (every channel of kind `general|group|task-run` visible to the user), "Direct Messages" section (one row per member with a DM open), admin footer with cog + sign-out.
  - **Centre:** channel header (name, run-status badge, model/agent count), message list (virtualised, cursor-paginated), composer.
  - **Right:** context pane. For a `task-run` channel → **Run drawer** (see M6.3). For a regular channel → thread / member drawer. For a DM → member profile + recent shared channels.
- [ ] **M6.1.3** Left sidebar rendering rules:
  - `#<name>` rendered for `general | group | task-run` channels.
  - Task-run channels render under a collapsible "Tasks" sub-section with a status dot (amber = pending-approval, green = running, grey = completed, red = failed). Active task-run channels with unread messages bubble the unread count.
  - DMs list shows presence dots driven by `MemberSchema.presence` (`online | offline | busy | away`).
  - `self` channels do **not** appear in the sidebar; they live under the user's own avatar menu as "My notes" (for humans, read-only view of their own scratchpad; for agents, not surfaced in the human UI — only in the Audit surface).

### M6.2 — Channel header + message list

- [ ] **M6.2.1** Channel header (centre-top): `# <channel-name>`, a status pill (`run active` amber, `pending approval` yellow, `completed` grey), and a metadata strip (`"{active_agents} agents · {provider}/{model}"`). Driven by the task-run channel's `task_run_id` → `GET /runs/:id/detail`.
- [ ] **M6.2.2** Message row variants:
  - **`kind='system'`**: centred grey pill. Used for join events, run-started, approval-requested headers, conflict notices (X.6), archival notices.
  - **`kind='human'` / `kind='agent'`**: avatar + display_name + timestamp + body. Avatar initials coloured per role (deterministic hash of `role_name`). Author's own messages right-aligned only in DMs; centre-aligned elsewhere (Slack-style, not iMessage-style).
  - **Tool-call card**: inline inside the authoring message. Renders `{tool_name} {summary-of-args} {status-icon} {result-summary}`. States: `running` (spinner), `ok` (check), `pending approval` (pause icon), `blocked` (red x), `error` (red triangle). Click expands full args + result JSON.
  - **Approval card**: inline inside a `kind='system'` message, surfaces `ApprovalRequestSchema` with accept / reject buttons. Resolving posts a `kind='system'` reply and updates the source card.
  - **Progress affordance**: a yellow bar anchored at the bottom of the message list when a run is mid-turn, driven by `run.step`. Matches the screenshot's bar.
- [ ] **M6.2.3** Virtualisation via TanStack Virtual; cursor pagination upwards on scroll-to-top.
- [ ] **M6.2.4** Edit / delete affordances on the user's own messages (hover menu). Deleted messages render `[deleted]` + author + timestamp; the tool-call cards inside stay visible (principle: append-only history).

### M6.3 — Run drawer (the right pane in the screenshot)

Composes one component bound to `GET /runs/:id/detail` + live-updates on `run:updated`:

- [ ] **M6.3.1** Header: `RUN #<short-id>` + status pill (matches the channel-header pill) + execution mode + agent count.
- [ ] **M6.3.2** **Active agents** list. One row per member currently in a turn: avatar + display_name + one-line status (`"reviewing output"`, `"awaiting approval"`, `"running {tool_name}"`, `"idle"`). Status text comes from `RunStateSchema.step + summary` — intelligence-first: the runtime asks the agent's current turn to emit a sub-20-token status summary, stored in `run.step` (principle #1). Click a row → scrolls the message list to the agent's most recent message.
- [ ] **M6.3.3** **Run tokens**. Per-agent horizontal bar (shadcn `Progress`) showing token count for this run. Data from the cost meter (M7.4.4) keyed by `member_id`. Matches the screenshot's `14.2k` / `18.7k` meters.
- [ ] **M6.3.4** **Tools this run**. Per-tool count + a status icon on the row where the call is in a non-terminal state (`pause icon` for pending approval, matching the screenshot's `write_file ‖ 1`). Derived from `run.tools` aggregate; keeps a clickable list so the user can jump to the most recent call of that tool.
- [ ] **M6.3.5** Pending-approval indicator at the top of the drawer (matches the yellow dot + "Pending approval" text in the screenshot). When the user clicks it, the centre pane scrolls to the pending approval card in the message list.
- [ ] **M6.3.6** **Todo list** section (from M3.1.7.5). Per-agent collapsible list of `todos` scoped to this run; open items on top, resolved items collapsed. Humans can add via a quick-add input; the add is attributed to the human in audit, not the supervisor. Clicking a todo jumps to the task-run channel message that created it (if any).
- [ ] **M6.3.7** **Supervisor tokens** break-out in the Run tokens section (M6.3.3) — stacked bar segment rendered in a lighter shade so `worker tokens` and `supervisor tokens` are visually distinct per agent. Sourced from the `kind: 'supervisor'` cost-meter tag (M3.1.7.8).

### M6.4 — Composer

- [ ] **M6.4.1** Multi-line input with send on `Enter` (shift-enter for newline). Placeholder literal: `"Message #{channel-name} or @mention an agent…"` to match the screenshot.
- [ ] **M6.4.2** `@mention` autocomplete popover: fetches `GET /orgs/:id/members?query=...` on typing. Resolves to `member_id`; message payload carries resolved ids in `mentions[]` matching `MessageSchema.mentions`.
- [ ] **M6.4.3** Slash-command popover on leading `/`: `/task run <team> <prompt>`, `/task kill`, `/gate approve`, `/gate reject`. Each command resolves to a REST call; the `/` is not persisted in the posted message.
- [ ] **M6.4.4** **No "Run as task" affordance.** Task promotion is an AI decision (M3.2.1) — no button. When the runtime decides to auto-promote or ask-to-confirm, it posts a `kind='system'` card inline in the channel that renders a Cancel button (for `promote`) or Yes / No / Edit team buttons (for `confirm`). The composer stays clean — its only responsibilities are typing, `@mention` autocomplete (M6.4.2), and the `/` slash-command popover (M6.4.3).

### M6.5 — Other surfaces

- [ ] **M6.5.1** **Members page.** Columns: avatar / display_name / role / workspace scope / last seen / provider binding. Row actions: Message, Assign task, Edit scope, Retire. CTAs: Invite human, Add agent. The "Invite human" / "Add agent" flows create `org_members` + `workspace_members` rows via a single POST each.
- [ ] **M6.5.2** **Workspaces switcher** in the app header (dropdown). Phase-1 typically one workspace per org, but the switcher exists for future multi-workspace users.
- [ ] **M6.5.3** **Governance drawer.** IAM matrix, audit log, pending gates. Uses `packages/governance-ui` (extracted in M5.3.1).
- [ ] **M6.5.4** **Providers page** (M7.2.1).
- [ ] **M6.5.5** **Task runs page.** Historical list with filters (status, team, date); clicking a row jumps to its task-run channel.
- [ ] **M6.5.6** **Conflicts tab** (when X.6 ships). Unresolved + recent conflicts with evidence drill-down.

### M6.6 — Auth + secrets

- [ ] **M6.6.1** Paste-the-daemon-token flow; stored in `localStorage` in dev. Cloud OIDC deferred to phase 2.
- [ ] **M6.6.2** Provider keys never round-trip to the browser (M7.1.3 contract).

### M6.7 — Accessibility + tests

- [ ] **M6.7.1** Keyboard nav across sidebar → message list → composer → run drawer; ARIA roles on IAM matrix + members table; focus rings; prefers-reduced-motion disables streaming-cursor animations.
- [ ] **M6.7.2** Playwright tests against a daemon fixture:
  - Boot fixture, connect, see #general populated with member-joined system messages.
  - Type `/task run` → pick team → task-run channel created → navigate to it → approval card renders → accept → run completes → summary posts in #general + origin.
  - `@mention` an agent → message posts → agent wakes → reply lands in the same channel.
  - DM an agent → DM channel lazy-creates → conversation streams.
  - Conflict fires → system message in shared group channel + DMs to involved members (X.6).
- [ ] **M6.7.3** Screenshot diff baseline against the reference design for the three-pane layout + run drawer; re-baseline requires a PR reviewer sign-off so drift is deliberate, not accidental.

---

## M7 — Multi-provider BYOK + hardening

Providers are first-class org-scoped entities with per-member routing. Hardening wraps up the security posture before the decision gate.

### M7.1 — Provider schema + secret store

- [ ] **M7.1.1** Schema migration `005_providers`:
  - `providers(id, org_id, kind, label, key_ref, base_url?, default_model, created_at, last_tested_at)` where `kind ∈ anthropic|openai|google|openrouter|ollama|custom`
  - `provider_bindings` table already from M1.4.1; M7 adds `model_override` fill + `fallback_order`.
- [ ] **M7.1.2** Secret store. `key_ref` is a pointer to `$UJIMA_HOME/secrets/<uuid>`; mode `0600`; boot refuses to start if any `key_ref` is world-readable. Secrets never logged, audited, or in OTel attributes.
- [ ] **M7.1.3** Provider API shape. `GET /providers` returns `{ id, kind, label, default_model, last_tested_at }` only — never keys. Test endpoint `POST /providers/:id/test` fires a 1-token ping and records `last_tested_at`.

### M7.2 — Dashboard + CLI

- [ ] **M7.2.1** Dashboard Providers page. Add / edit / test / retire. Key input is password-typed; once saved shows `••••<last 4>` + Rotate. Raw key never round-trips back.
- [ ] **M7.2.2** CLI: `ujima provider add <kind> --label X --key-file ./key.txt`, `ujima provider test <id>`, `ujima provider list`, `ujima provider retire <id>`.

### M7.3 — Routing + fallback

- [ ] **M7.3.1** `@ujima/llm` reads the active member's `provider_bindings` (ordered by priority), resolves the first available provider + model, constructs the AI SDK `LanguageModel` (M1.3.1).
- [ ] **M7.3.2** On provider-level error (429, 5xx, network), falls back to the next binding and writes a `provider.fallback` audit row.

### M7.4 — Hardening

- [ ] **M7.4.1** Prompt-injection defence pass. Every MCP tool response passes through a sanitizer that strips system-prompt-looking prefixes before entering the LLM's context.
- [ ] **M7.4.2** Threat model doc at `docs/security.md`. Required reading in the contributing checklist.
- [ ] **M7.4.3** OTel instrumentation. Spans around event bus publish, MCP tool call, agent turn. OTLP export configurable.
- [ ] **M7.4.4** Cost meter. Tokens in/out, $ per agent / task / workspace. Surfaced in dashboard rate panel + `ujima cost show`.
- [ ] **M7.4.5** Rate limiting at the API gate — closes Epic 13.7. Per-token sliding window on `POST /tasks`, `POST /providers/:id/test`, `POST /skills`. Reuses `@ujima/permissions` once the sliding-window primitive is exported.
- [ ] **M7.4.6** Mark `tasks.md` 11.23, 11.25, 11.26, 11.28 as superseded-by-M7.4.

### M7.5 — Tests

- [ ] **M7.5.1** Add provider → bind to member → task run uses the right model. Primary returns 429 → fallback triggers → audit row records the swap. Committed `ujima.config.ts` with a raw-string `apiKey:` fails Zod validation. `GET /providers` contains no key fragments.

---

## Cross-cutting

### SKILL.md library

Phase-one replacement for the four-layer memory stack. Open standard, file-backed, composable.

- [ ] **X.1** Skills directory at `<workspace_root>/.ujima/skills/<name>/` with `SKILL.md` + optional scripts/assets. Every skill is local to the workspace; never a global system dependency.
- [ ] **X.2** `ujima skill add <source>` in the CLI (M4.3.9). Fetches securely, writes strictly inside the skills directory, rejects anything that tries to escape.
- [ ] **X.3** Skill-to-member binding via config (`roles.frontendEngineer({ ..., skills: ['react-review'] })`) or dashboard.
- [ ] **X.4** Execution context. At agent spawn, `SKILL.md` contents compose into the member's system prompt. Custom tool scripts that ship with a skill run under the daemon's policy — constrained to the workspace root, still subject to approval gates for writes / shell / git.
- [ ] **X.5** Per-agent markdown memory at `$UJIMA_HOME/agents/<workspace_id>/<agent_id>/memory/*.md` — lightweight phase-one substitute for the four-layer memory stack. No driver abstraction, no joint memory, no dream pass. **Note:** the agent's self-channel (M2.2.3) is the *primary* short-to-medium memory surface; these files are the longer-lived named-topic store the agent writes to intentionally (cf. Claude Code's `MEMORY.md` pattern).

### Conflict resolution via channels (X.6 — lands in phase 2 per ADR 0002; shape fixed now)

Per principle #2, conflict resolution is **channel-native** — no modal surface. Per principle #1, **routing is LLM-decided, not hardcoded**: the referee reads the org chart + project context and picks both the resolution *and* the audience. Only two fan-out targets are hardcoded (structural invariants): the task-run channel of record, and each conflicting agent's self-channel. Everything else — which role-group channels see it, who gets DMed, which senior escalates — is the referee's decision.

- [ ] **X.6.1** **Two-layer fan-out.**
  - **Mandatory (hardcoded, structural):** (a) a `kind='system'` message in the **task-run channel** where the conflict arose — the durable record; (b) a `kind='system'` message in each conflicting agent's **self-channel** framed as "think about this" — the private reflection surface.
  - **LLM-decided (per-conflict):** the referee turn (X.6.2) returns an `audience` payload `{ roleGroupChannels: string[], directMessages: { member_id, addressed_as: 'conflicting'|'informed'|'escalation_target' }[] }` and the runtime executes exactly that fan-out. No hardcoded "DM every conflicting agent" or "post to every involved role group" rule.
- [ ] **X.6.2** **Referee turn — org-chart-aware, fully intelligence-layer (principle #1).** Detection is deterministic (the four detector classes carried over from `evolution.md` 21.1 — `cross_domain_semantic`, `intra_domain_contradiction`, `dependency_staleness`, `approval_bypass`); **every downstream decision is an LLM turn.** The referee reads:
  - The conflict evidence payload from the detector.
  - The disputed artifact(s) (file diffs, value pairs, stale-dependency graph, approval-bypass trace).
  - Each involved member's recent self-channel context (last N turns).
  - The workspace's [`OrganizationChartSchema`](../ujima-agents-main/packages/shared/src/schemas.ts) — `reportsTo` + each member's role + seniority.
  - The current task-run metadata (team, prompt, execution mode, `RunState.summary`).
  - The project context snapshot — `project_context` view: active task runs, open todos (M3.1.7.5), recent audit events, and the `ujima.config.ts`-declared project purpose if any.

  The referee returns a structured proposal: `{ proposal_id, summary, winning_value, rationale, suggested_next_actions[], audience, escalationTarget?: { member_id, reason } }`. **No hardcoded L1/L2/L3 hierarchy, no hardcoded "PM for project questions, QA lead for standards"** — the referee's prompt *describes* the org chart and the question types, and the LLM picks the target. Example rationales the referee may produce, without a hand-wired mapping:

    > *"This dispute is about a product requirement, not a code standard. The org chart shows the PM `Morgan` is the parent of both frontend-engineer and backend-engineer for this workspace; Morgan is the escalation target. Audience: `#frontend-engineers` and `#backend-engineers` for transparency, DM Morgan as the escalation_target."*

    > *"This dispute is about coding standards (lint rule, pattern guideline). Audience: `#standards-council` only. Escalation target: QA lead `Priya`. Do not spam the PM — not their call."*

- [ ] **X.6.3** **Resolution message contract.** The referee's proposed resolution is a payload `{ proposal_id, summary, winning_value, rationale, suggested_next_actions[], audience, escalationTarget? }` embedded in the mandatory `kind='system'` message in the task-run channel, with Accept / Reject buttons. Accepting resumes the paused agents with the winning value + posts a confirmation in each involved member's self-channel. Rejecting either reopens to human review in the Pending Gates surface or asks the referee to try again with new evidence or a different audience (human choice).
- [ ] **X.6.4** **Selective pausing.** Only agents downstream of the conflict pause (per-agent `AbortController.pause`). Siblings on unrelated subtrees keep running. On resolution, paused agents receive a `kind='system'` message in their DM: `"[ujima] Conflict resolved — resume with value: …"`.
- [ ] **X.6.5** **Governance tab.** Dashboard "Conflicts" tab (M6.5.6) aggregates every `conflict.raised` WS event with drill-down to the referee's audience payload (so a human can see *why* the referee picked a particular escalation target and correct it if wrong).
- [ ] **X.6.6** **No `@mention` on conflict notices.** Conflict notices are `kind='system'`; reach is via the referee-chosen fan-out above, not `@mention`. Keeps the mention-storm rate limit (M2.4.4) from throttling conflict resolution.
- [ ] **X.6.7** **Deterministic fallback for the referee (principle #1).** If the referee LLM call fails (provider timeout, malformed output, empty audience), the runtime falls back to a minimal safe audience: task-run channel + each conflicting agent's self-channel + a single DM to the workspace owner asking for human resolution. Never stalls; never silently drops the conflict.
- [ ] **X.6.8** **Tests.**
  - Product-requirement conflict → referee's rationale references `OrganizationChart.reportsTo[conflicting_member]` → escalationTarget is the parent PM → DM goes to PM, audience excludes QA.
  - Coding-standard conflict → escalationTarget is QA lead → audience is the standards channel → PM not DMed.
  - Referee returns empty audience → fallback engages → owner gets a DM.
  - Detector fires but `OrganizationChart` is missing a `reportsTo` edge → referee's rationale notes the gap and defaults to workspace owner; no crash.
  - Referee picks a retired member as escalationTarget → runtime catches `ERR_MEMBER_RETIRED`, asks referee to re-decide with a narrowed candidate list, falls through to owner if second attempt also invalid.

### Escalate tool (X.6a — lighter than conflict; intelligence-layer routing)

For **soft disagreement** that doesn't rise to detector-grade conflict, the heavy machinery (paused siblings, referee turn) is overkill. Add an `escalate` tool so an agent can ask a senior for a decision without triggering conflict resolution.

- [ ] **X.6a.1** Internal tool `escalate({ topic, context, hint_role? })` available to every agent member. Always allowed (no governance gate — an agent asking for help is never blocked; the decision of *who* to route to is the intelligent part).
- [ ] **X.6a.2** **Routing is an LLM turn, not a hardcoded `topic → role` map.** When `escalate` is called, the runtime invokes a small `streamText` with: `{ topic, context, orgChart, callerRole, callerTeam, hint_role? }`. Returns `{ target_member_id, audience_channel_id?, rationale }`. The LLM picks from the org chart.
- [ ] **X.6a.3** Runtime posts a `kind='system'` message in the caller's task-run channel (or origin channel for non-run escalations): `"{caller} is asking {target} about {topic}"` with a DM to `target` carrying the full context. Target answers via normal channel primitives — no special "escalation resolve" endpoint.
- [ ] **X.6a.4** No sibling pausing. No referee turn. `escalate` is a routing helper; the agent keeps working while waiting for the answer (unless it explicitly awaits, which is a worker-level choice).
- [ ] **X.6a.5** Audit row `audit.escalation` with `{caller, target, topic, rationale}`. Phase-2 analytics: "which escalations get repeated?" → signal that the target role is under-staffed or the org chart is wrong.
- [ ] **X.6a.6** **Why not expose `conflict.raise` as a tool.** An agent that calls `conflict.raise` on soft disagreement would trigger the heavy fan-out + paused siblings + referee turn — that's abuse-prone and duplicates the detector path. The detector owns *whether a conflict exists* (evidence-grade); `escalate` owns *soft routing*. Two tools, two signal-strength tiers, no ambiguity about which path gets the heavy machinery.

### Self-note scratchpad (X.7 — ships with M2.2.3)

Enumerated as a cross-cutting because it shows up in every client and tool surface:

- [ ] **X.7.1** Every agent member gets a `kind='self'` channel on spawn (M2.2.3). Private to the member. The human admin can view it via the Audit surface; no other member can.
- [ ] **X.7.2** Agent ergonomic API: `self.note({ body })` tool (M2.3.2). The tool can be called any number of times per turn — it's the agent's thinking-out-loud primitive. Not gate-controlled (principle #1 + M2.3.3).
- [ ] **X.7.3** On every agent turn, the last K self-channel messages (default 20) are prepended to the agent's turn context under `## Recent notes`. Size-bounded in tokens; older notes fall off but stay readable via `channel.read({ channel_id: self.channel_id, since })`.
- [ ] **X.7.4** Self-channel search: agent may call `channel.read({ channel_id: 'self', query })` with an FTS query on its own notes — lets an agent recall a prior decision without re-reasoning.
- [ ] **X.7.5** Conflict fan-out (X.6.1 step 4) posts into the self-channel so the agent can think about a conflict privately before replying publicly. `ConflictEvidence` is included in the self-note payload.
- [ ] **X.7.6** Retired members' self-channels are archived but kept indefinitely for audit; UI renders them under the Audit surface's "Retired members" filter.

### Intelligence-first catalog (X.8)

An explicit list of places the plan defers a decision to an agent turn rather than hardcoding. This is the principle #1 audit trail. Every item here is intentional; removing one requires an ADR update because it flips a design axis.

- [ ] **X.8.1** **Task-channel slug naming** (M3.1.1): a 1-token LLM call names the channel from the prompt. Falls back to a deterministic short-id on timeout.
- [ ] **X.8.2** **Per-agent status summary** (M6.3.2): the agent emits a sub-20-token status string each turn (`"reviewing output"`, `"awaiting approval"`, etc.). Not a state machine.
- [ ] **X.8.3** **Task promotion** (M3.2.1): whether a human message *is* a task, and which team should run it, is decided by the promoter LLM turn on each eligible message. No heuristics, no regex, no keywords. Fallback: `skip` on failure.
- [ ] **X.8.4** **Conflict referee + audience routing** (X.6.2): the referee turn reads the `OrganizationChartSchema` + project context and returns both the resolution proposal *and* the audience set (which role-group channels, which DMs, which escalation target). No hardcoded seniority tree, no hardcoded `topic → role` map.
- [ ] **X.8.5** **Escalate routing** (X.6a.2): `escalate({topic, context})` picks the target member via an LLM turn over the org chart. Not a static routing table.
- [ ] **X.8.6** **Self-note recall** (X.7.4): FTS search lets the agent retrieve its own prior reasoning; the agent decides what to recall.
- [ ] **X.8.7** **Memory compaction** (M2.2.4, phase 2 for joint memory): an LLM summarisation turn, not a hand-written rollup heuristic.
- [ ] **X.8.8** **Team handoff routing** (phase 2): when an agent wants to hand a subtask to another team, the receiving role's senior decides which member to assign. No hardcoded round-robin.
- [ ] **X.8.9** **Supervisor status answer** (M3.1.7.2): the supervisor LLM decides what's relevant from `RunState` + self-channel + task-run history to answer a DM. Not a template response.
- [ ] **X.8.10** **Where we explicitly keep it hardcoded** (structural invariants, per principle #1): path scope enforcement, approval gate evaluation, permission checks, Zod schema validation, auth / bearer token checks, TLS enforcement on non-loopback binds, token file mode checks, workspace-root gate (`ERR_NO_WORKSPACE_ROOT`), **only humans can originate a task (agent `@mention` of a team never auto-promotes)**, conflict detection classes, the two mandatory conflict fan-out targets (task-run channel + involved self-channels), supervisor write-tool allowlist, promoter dedupe window.

### Schema preservation rule (X.9)

- [ ] **X.9.1** The Zod schemas in [`ujima-agents-main/packages/shared/src/schemas.ts`](../ujima-agents-main/packages/shared/src/schemas.ts) and [`events.ts`](../ujima-agents-main/packages/shared/src/events.ts) are the **canonical shapes** for every overlapping entity: `Organization`, `Member`, `Channel` (with `kind: general|group|dm`), `ConversationThread`, `Message` (with `kind: human|agent|system`), `ApprovalRequest`, `AuditEvent`, `RunState`, `ToolCall`, `ToolResult`, `ProviderBinding`, `WorkspaceConfig`, `OrganizationChart`, `RoleScopes`, `ToolCapability`, all enums. Socket event names come from `SocketEventNames`.
- [ ] **X.9.2** `@ujima/api-schema` is **additive**: our workspace DTO (Phase-0 shipped), task DTO, event-subscribe query, our WS frame wrappers (M2.3.1), `member.alerted`, `conflict.raised`, `conflict.resolved`, `channel.archived` — all of these extend the base without touching it. Our `ChannelKind` adds `task-run | self`; our `MessageKind` reuses theirs verbatim.
- [ ] **X.9.3** The CI import path is `import { Channel, Member, … } from '@ujima/api-schema/external'` where `@ujima/api-schema/external` **re-exports** the sibling schemas unmodified. When the sibling bumps, we bump our re-export and add an adapter for any breaking change — with a new ADR.
- [ ] **X.9.4** Breaking a sibling schema (adding a required field, renaming an enum value, changing a kind literal) is an **explicit ADR event** — not a routine edit. Adding an optional field to our additive layer is routine.
- [ ] **X.9.5** Test contract: every sibling schema round-trips through Zod's `.parse()` in our test suite. If the sibling changes a type, our tests break loudly — we can never silently drift.

---

## Phase 2+ (deferred; decision-gated at end of M7)

These are real future investments, not dead letters. They unlock at the end of M7's decision gate only if the product needs them:

- **Four-layer memory + dream agent** — old Epics 17, 18, 20. Requires usage data showing agents need shared/nightly-distilled memory.
- **KAIROS observer** — old Epic 25. Requires scheduled / cron use cases beyond what M4's CLI covers.
- **Conflict detection §7b** — old Epic 21. Approval gates + audit cover the phase-1 safety floor; §7b detectors are a phase-2 investment.
- **Memory driver abstraction** — old Epic 19. Supermemory **rejected outright** (proprietary); Postgres + OpenMemory adapters unlock only if self-hosters ask for them.
- **Docker compose self-host** — old Epic 23. Unlocks when the first small-team user asks for a non-IDE deployment.
- **Managed cloud skeleton** — old Epic 24. Tenancy, OIDC, billing — gated by an explicit go-decision; not productised in this plan.
- **Multi-workspace-per-daemon threading** — old Epic 12.9 full thread-through. Schema exists; feature lands only if users hit the "one root per org" constraint.
- **Open platform + registry + marketplace** — old Epic 27.

---

## Known risks + open questions

These are decisions to revisit *as* milestones start, not up front.

1. **AI SDK lock-in (M1.3).** Adopting `@ai-sdk/*` deletes a large hand-rolled surface but couples the orchestrator to Vercel's abstraction. Mitigation: the `LanguageModel` boundary is small; `packages/llm/legacy/` is the 90-day escape hatch; Ujima's higher-order orchestration (waves, gates, memory) stays ours.
2. **Config vs. dashboard ownership (M1.2).** `owner ∈ 'config'|'dashboard'` per field + `allowDashboardOverride` opt-in keeps "code wins" as the default. Channel messages / audit rows / memory / task runs are never config-owned.
3. **Channel volume scaling (M2.5).** A 10-agent run can emit hundreds of messages/hour. Defaults: 90-day retention for public kinds, indefinite for dm + self, JSONL archive, FTS5 locally, cursor pagination day one. First workspace hitting 10M rows is the signal to invest in partitioning, not a day-one concern.
4. **Provider fallback semantics (M7.3).** A quiet swap from Anthropic → OpenAI mid-task changes behavioural character. Every fallback writes a `provider.fallback` audit row; dashboard rate panel surfaces the count. Teams wanting no-fallback set `priority:` with a single entry.
5. **Task channel emit volume (M3.1).** Streaming every token into a task-run channel is too chatty. Batch at turn boundaries; render tool calls as cards inside a single message rather than one message per chunk.
6. **Onboarding gate + per-role scopes (M1.5).** The daemon refuses work until `root_path` is set. Dashboard / plugin / CLI first-run flows all cut in on `ERR_NO_WORKSPACE_ROOT`.
7. **`ujima-agents-main` drift.** Sibling repo may evolve; this plan treats the 2026-04-20 snapshot as canonical. Meaningful divergence requires a new ADR. The schema-round-trip tests (X.9.5) catch drift loudly.
8. **Legacy `tasks.md` items.** Anything not explicitly superseded (21.9, 22.6, 26.7, 27.7, plus M3.3.4 / M7.4.6) stays actionable under `tasks.md` until its work ships.
9. **Thin-client UI latency (M5, M6).** Governance IAM is snappy today because everything is in-process. Over REST + WS, expect 50–200ms round trips per click. Mitigations: optimistic UI on policy toggles, batched bulk edits.
10. **`packages/ujima` public name (M1.1).** Sibling imports from unscoped `ujima`; our repo is `@ujima/*`. Decision deferred to M1.1 kickoff; one find/replace either way.
11. **Mention loops (M2.4.4).** An agent that `@mentions` itself or another agent every turn would create a runaway; the sliding-window rate limit caps it at 10/min/agent and posts a `member.alert_throttled` system message when hit. Self-mentions suppressed entirely (M2.4.5).
12. **Message edits × tool-call cards (M2.5.3).** Editing a message never rewrites its tool-call cards — the cards render from an immutable `tool_calls` column. Delete is a tombstone; the cards stay visible in their original message with `[deleted]` context.
13. **Retired member references (M1.4.4).** Every message captures the author's `display_name` at post time (not live-looked-up). Past messages stay readable after retirement. Hard delete leaves a tombstone; `member_id` never reassigned. Retired members' self-channels archived, not deleted (X.7.6).
14. **WS reconnect replay (Phase 0 + M2).** The transport layer's replay buffer (Epic 13.3) uses `since_ms`; on long disconnects the client walks `pending_events` from its cursor. If the buffer is pruned before reconnect, the client does a cold fetch (`GET /channels/:id/messages?since=…`) to recover.
15. **Config drops a channel / agent that has messages.** Reconcile loop **archives** the channel / retires the member (M2.2.2, M1.4.4); never hard-deletes messages. The user's banner shows "Managed by ujima.config.ts — channel archived" so the drop is visible in UI.
16. **DM to retired member.** `channel.dm({ member_id })` where the member is retired returns a structured error (`ERR_MEMBER_RETIRED`) to the agent; the agent reads and adapts (principle #1 — the agent decides whether to route to another team member rather than the runtime force-picking).
17. **Self-channel for retired agent.** Archived, kept indefinitely under Audit. The member's `org_members.retired_at` is set; the self-channel's `archived_at` mirrors it.
18. **Referee agent recursive conflict (X.6.2).** The referee is itself an agent — if it produces a contradicting proposal on re-runs, the detector's `approval_bypass` class doesn't re-fire on its output (referee messages are `kind='system'`, exempt). If two human rejections stack on the same conflict, it escalates to the Pending Gates surface for a blocking human decision.
19. **Approval-gate state consistency.** An `ApprovalRequest` embedded in a `kind='system'` message is the **source of truth**; the message renders a live binding to the row. Two clients accepting simultaneously: the first write wins via `UPDATE ... WHERE status='pending'`, the second sees a 409 and its button disables.
20. **Task-run channel name collisions.** Slug generator (X.8.1) appends a 3-char short-id suffix; collisions are astronomically unlikely but we reject on unique-constraint violation and regenerate with a longer suffix.
21. **Two concurrent runs.** Each run has its own task-run channel — no conflict at the channel level. Shared files are still governed by approval gates + conflict detection (X.6); the detectors operate over *audit* evidence, not channel membership.
22. **Agent `@mentioned` in a channel it's not a member of.** Auto-joins with a `kind='system'` message `"{display_name} joined (mentioned by {by})"`. Exception: `self` channels never auto-join (private).
23. **Public self-channel leak risk.** Self-channels use `kind='self'` and the query layer filters them out of any `scope='all'` listing unless the caller is the member or an admin. Write a regression test that proves a non-admin member's `channel.list({scope:'all'})` does not see others' self-channels.
24. **Skill script approval paths.** A `SKILL.md` with an accompanying script that writes files still goes through the same approval gate as any other write tool — the skill is a capability, not a bypass. Document in X.4.
25. **Role-scope path enforcement gap.** A member with `role_scope_paths: ['apps/web']` calls an MCP tool passing `apps/api/secret.env`; `PathResolver` rejects with `ERR_PATH_ESCAPE`; the structured error goes back to the LLM; agent adapts (principle #1). No silent success.
26. **Intelligence-first failure modes.** Every X.8 item has a deterministic fallback — LLM timeout / refusal reverts to the hardcoded default (slug = short-id, status = step-number, suggestion = off, referee = "no resolution" escalates to human). Never stall the user on an LLM call.
27. **Running with zero provider bindings.** `startTask` with no usable provider returns `ERR_NO_PROVIDER` (additive error code). Dashboard surfaces it on the run-detail drawer with a "Configure providers" CTA to M6.5.4.
28. **Supervisor during an approval-pending worker (M3.1.7).** Worker is paused on an `ApprovalRequest`; human DMs the agent "what are you waiting on?". Supervisor reads `RunState` (`status='awaiting_approval'`, `summary` from the last tool card) and the embedded `ApprovalRequestSchema`, answers with the pending tool name + path + risk reason, and includes a direct link to the approval card. Does **not** attempt to resolve the approval from the DM — approvals resolve only via the card's Accept/Reject (single source of truth, per risk #19).
29. **Supervisor asked about a finished run.** DM references a run that's already `completed`/`failed`. Supervisor answers from the task-run channel's summary message (M3.1.5) + `RunState.summary` — no worker to read from. Uses the same deterministic fallback template as M3.1.7.9 if the provider is down.
30. **Two simultaneous DMs to the same agent.** Mutex on `member_id + 'supervisor'` serialises; second DM waits up to 2s for the first turn to finish, then coalesces into a single context if both arrive inside the debounce (M3.1.7.6). Third and later DMs queue; beyond depth 5 the oldest gets an auto-reply ("busy — see #{task_run_channel}").
31. **Supervisor leaking worker secrets.** Supervisor's tool allowlist (M3.1.7.4) blocks `read_file` on arbitrary paths, so a DM like "paste the config file" cannot exfiltrate. `channel.read` of the worker's task-run channel is allowed (it's the agent's own output) but regression-tested to refuse `self` channels of other members and DMs the agent isn't a party to.
32. **Worker-satisfies-todo race.** Worker calls `todo.check(id)` at the same instant the supervisor calls `todo.add` with the same text. Resolved via unique `(member_id, body_normalized, state='open')` constraint: the second insert errors, the supervisor's `todo.add` sees a `409` and reports "already tracked" to the user.
33. **Promoter false positive (M3.2.1).** Human types "we should refactor auth someday" — promoter mis-reads and auto-creates a task. Mitigations: 10s Cancel window on every `promote` card; `confirm` is the default for ambiguous messages (0.5 ≤ confidence < 0.8); Audit drawer shows recent promoter decisions so a mis-classification is visible; `audit.task_promoter` rows feed phase-2 prompt tuning.
34. **Promoter false negative.** Human says "please fix the broken staging deploy now" — promoter skips. Fallback: `/task run` slash command always works (M3.2.2). Phase-2: humans can react to a message with a "treat as task" affordance that retrains the promoter.
35. **Agent tries to auto-promote by impersonating a human.** Structural invariant (X.8.10): the promoter runs only on `kind='human'` messages. Agent-authored messages are never evaluated; an agent `@mentioning` a team wakes members but never promotes. Even a compromised agent cannot originate a task.
36. **Escalate loop (X.6a).** Agent A escalates to B, B escalates the same topic back to A. Mitigations: `audit.escalation` carries a `chain_id`; a second escalation with the same `chain_id` to a previously-seen target posts a `kind='system'` notice in the task-run channel and stops the chain; the agent must resolve locally or fail the turn.
37. **Referee picks a wrong-but-plausible target.** Referee routes a standards question to the PM. Human sees the mis-routing in the dashboard Conflicts tab (X.6.5 drill-down shows the referee's `rationale` + `audience`). Rejecting the proposal (X.6.3) lets the human either reassign or re-run the referee with a narrower hint. The referee's decisions are inspectable so mis-routing is correctable, not silent.
38. **Referee needs a project purpose that isn't in `ujima.config.ts`.** The `project_context` snapshot (X.6.2) includes config-declared purpose if present; if absent, the referee reads the most-recent task-run summaries + recent `#general` pinned messages. Still an LLM decision over whatever context is available; the org chart alone is usually enough.
39. **Escalate target is currently in a task run.** Target's supervisor loop (M3.1.7.2) handles the DM — that's exactly what supervisor is for. Escalate doesn't require the target to be idle.
