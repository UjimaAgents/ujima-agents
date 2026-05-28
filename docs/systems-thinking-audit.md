# Systems Thinking Audit

This document maps Ujima against three builder questions:

1. Where does state live?
2. Where does feedback live?
3. What breaks if I delete this?

The goal is to make the system legible without running it. A contributor should be able to identify the owner of truth, the feedback path, and the deletion blast radius before changing a subsystem.

## 1. Where State Lives

### Durable Product State

The durable source of truth is SQLite under the runtime home directory.

- Database open and migration owner: `packages/context-store/src/db.ts`
- Runtime composition owner: `packages/runtime-core/src/runtime-host.ts`
- Repository facade: `packages/runtime-core/src/repositories/index.ts`
- Production repository wiring: `apps/api/src/main.ts`

The database owns these major aggregates:

| State | Durable Tables / Store | Main Code Owner |
| --- | --- | --- |
| Organizations and workspace root | `organizations`, `workspace_settings`, `workspaces` | `Repository`, `WorkspaceService`, `ConfigSyncService` |
| Members, roles, channels, threads, messages | `members`, `channels`, `channel_members`, `threads`, `messages`, `message_mentions` | `ConversationService`, `SettingsService` |
| Runs and tool traces | `runs`, `run_steps`, `audit_events` | `SpiritService`, `ToolServiceImpl` |
| Approvals | `approvals` plus persisted grants | `ApprovalService`, `ToolServiceImpl` |
| Task sessions and spirits | `task_sessions`, `spirits` | `TaskSessionService`, `SpiritService`, `ActiveSpiritRegistry` |
| Todos and commitments | `todos` | `SupervisorTodoService`, `CommitmentService` |
| Scheduled work | `scheduled_jobs` | `SchedulerService` |
| Memory, workspace file index, decisions | `memory_entries`, `workspace_files`, `decision_log` | memory tools, workspace tools, decision extractor |
| MCP and plugins | `mcp_servers`, `agent_mcp_attachments`, `mcp_tool_cache`, `plugin_installs`, `organization_skill_installs` | `McpRegistryService`, `PluginRegistryService` |

### Config State

Team shape is config-first.

- Public config framework: `packages/ujima/src`
- Config loading and reconciliation: `packages/orchestrator/src/services/config-sync.ts`
- Config ownership records: `config_field_ownership`
- ADR principle: `docs/adr/0002-adopt-ujima-agents-philosophy.md`

Rule of thumb: config owns declared team structure; the dashboard can operate and validate, and can override only where ownership allows it.

### Secret State

Secrets are not product rows.

- File-backed secret store: `packages/runtime-core/src/secret-store.ts`
- Provider credential rows store `key_ref`, not raw keys.
- MCP env/header material stores key refs, not raw values.

Rule of thumb: if a secret is visible in API responses, audit rows, or realtime events, that is a bug.

### Ephemeral State

Some state is intentionally live-only:

- `RuntimeHost` active task map
- `ActiveSpiritRegistry`, hydrated from persisted spirits on startup
- Per-member/channel wake throttles in `ConversationService`
- Per-run approval scope tracker in the tool service
- Web UI cache in `apps/web/src/features/workspace/workspace-store.ts`
- Socket/EventSource subscriptions

These are caches, throttles, or active process state. They may improve responsiveness, but they should not be the only source of durable user-visible truth.

## 2. Where Feedback Lives

### Runtime Feedback

The primary feedback loop is typed realtime events.

- Event names and schemas: `packages/shared/src/socket-events.ts`
- Realtime transport: `apps/api/src/transport/realtime.ts`
- Socket bridge / `/events`: `apps/api/src/transport/server.ts`

High-signal events include:

- message delivery: `channel:message`, `thread:message`, `dm:message`
- run lifecycle: `run:started`, `run:updated`, `run:completed`, `run:chunk`
- tool lifecycle: `tool:called`, `tool:result`
- approval lifecycle: `approval:requested`, `approval:resolved`
- wake lifecycle: `member.alerted`, `member.alert_failed`, `wake:suppressed`, `member.must_reply_failed`
- loop guards: `agent:mirror_suppressed`, `agent:echo_suppressed`, `agent:ack`, `agent:passed`
- task/worker lifecycle: `spirit:*`, `supervisor:replied`
- commitments and schedules: `commitment:*`, `schedule:executed`

### Audit and Trace Feedback

Tool and run history is persisted.

- Tool audit write: `ToolServiceImpl.audit`
- Run step write: `ToolServiceImpl.saveRunStep`
- Run detail and trace routes: `apps/api/src/transport/routes/runs.ts`
- Audit repository: `packages/runtime-core/src/repositories/audit.ts`

Core invariant: a tool action should leave both a realtime signal and a persisted trace. The system mostly follows this for tool calls, approvals, and run transitions.

### API and UI Feedback

HTTP errors use typed response shapes.

- API error schema: `packages/api-schema/src/index.ts`
- Route error helpers: `apps/api/src/transport/routes/route-errors.ts`
- Global unhandled route logging: `apps/api/src/transport/server.ts`

The web app projects server truth into local UI state.

- Client cache: `apps/web/src/features/workspace/workspace-store.ts`
- Conversation stream handler: `apps/web/src/features/workspace/use-conversation-sync.ts`
- Conversation stream params and payloads: `apps/web/src/features/workspace/conversation-transport.ts`

Rule of thumb: Zustand is a projection, not the truth. If browser state disagrees with SQLite, SQLite wins and the stream/bootstrap should repair the projection.

### Feedback Gaps To Watch

Several side effects are explicitly best-effort and currently do not always surface failure:

- Task promotion after a human message can fail without failing message publish.
- `ConversationService` post-publish hooks swallow failures.
- Commitment sweeper ticks catch and return silently.
- Trajectory recording catches and drops errors.
- Some route-level catches return client errors without structured logging.

That tradeoff protects the main user workflow, but it creates a systems-thinking risk: secondary systems can pretend to work. These paths need at least structured logs, counters, or realtime diagnostic events when they become operationally important.

## 3. What Breaks If I Delete This?

| Component | What It Owns | Delete / Break Blast Radius |
| --- | --- | --- |
| `packages/shared` | Canonical schemas, socket events, policy helpers, shared runtime types | Breaks API schemas, web parsing, realtime validation, repositories, orchestrator, and tests. Changes must be additive unless an ADR says otherwise. |
| `packages/api-schema` | HTTP request/response contracts | Breaks API route validation, Next.js proxy routes, client SDK, web app fetch parsing. |
| `packages/context-store` | SQLite schema, migrations, low-level task/audit/context stores | Breaks durable state, migrations, runtime boot, repository facade, tests. |
| `packages/runtime-core` | Runtime host, DB/repository construction, workspace store, secret store, MCP path sanitation | Breaks API daemon boot, CLI/runtime startup, old task path, workspace root enforcement, secret handling. |
| `packages/orchestrator` | Application service layer: conversations, runs, tools, approvals, schedules, spirits, settings | Breaks almost every user workflow while leaving raw DB and API shell behind. |
| `apps/api` | Fastify HTTP API, Socket.IO server, daemon startup, auth token enforcement | Web/SDK/CLI surfaces cannot talk to the runtime. Some internal services still exist but have no product-facing transport. |
| `apps/web` | Next.js UI, local cache projection, stream handling, settings and workspace UX | Daemon can still run, but the primary browser product surface is gone. |
| `packages/ujima` (`@ujima/framework`) | Public team config, roles, prompts, provider/model config | Config sync, role policies, prompt building, and onboarding lose their canonical team shape. |
| `packages/permissions` | Policy evaluation and legacy permission middleware | Tool safety checks lose a key gate; approvals and audit semantics drift. |
| `packages/mcp-client` | MCP connection pool and registry parsing | MCP settings and tool execution degrade or fail. |
| `packages/event-bus` | Local event bus and replay for legacy task/event flow | Runtime host task events and older task-mode paths break. |
| `packages/agent-runtime` | Legacy/concurrent task execution primitives | Older task-mode, VS Code task runner, and runtime-host `startTask` path break. |
| `packages/client-sdk` | External SDK wrappers | External consumers lose a stable client surface; product internals mostly survive. |
| `apps/vscode-extension` and `packages/webview` | Editor product surface | Web/API continue, but editor workflows and governance panels break. |

## Current Assessment

The system mostly answers the three questions well for the core path:

- State has a clear durable center: SQLite plus repository services.
- Feedback is strong for conversations, runs, tools, approvals, wakes, and UI projection.
- Blast radius is reasonably traceable through package boundaries and shared schemas.

The weak spot is not state ownership; it is secondary feedback. Best-effort side effects are intentionally decoupled from the main workflow, but some of them fail silently. That is acceptable for low-criticality projections, but risky for anything the user will trust as product behavior.

## Checklist For Future Changes

Before adding or changing a subsystem, answer:

1. What is the durable source of truth?
2. Is any in-memory state a cache, lock, throttle, or actual owner?
3. Which service is allowed to mutate the truth?
4. Which schema validates the boundary?
5. What realtime event tells the UI something happened?
6. What persisted audit or trace remains after the event is gone?
7. How does the user see failure?
8. How does an operator see failure?
9. What package imports this?
10. What test or route would fail if it disappeared?

If any answer is "nothing tells us," the subsystem is not done.
