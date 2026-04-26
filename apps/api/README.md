# @ujima/api

Local backend and runtime service for Ujima Agents.

This app owns onboarding, organization state, SQLite persistence, approvals, realtime events, tool execution, and AI orchestration. It is the source of truth for workspace boundaries and run execution.

## System Architecture

```mermaid
graph TD
    User([User])
    
    subgraph Clients ["Clients"]
        WebUI["Web UI / Next.js"]
        Extension["VS Code Extension"]
        CLI[CLI]
    end

    subgraph API ["Local API Service (apps/api)"]
        Fastify["Fastify Server"]
        EventBus["Realtime Event Bus"]
        Orchestrator["Agent Orchestrator"]
        ApprovalService["Approval Service"]
        Database[(SQLite DB)]
    end

    subgraph Framework ["Framework Layer"]
        SDK["@ujima/framework"]
        Config["ujima.config.ts"]
    end

    subgraph Runtime ["Execution Runtime"]
        Tools["Tool Adapters: FS, Shell, MCP"]
        Workspace["Local Filesystem Workspace"]
    end

    LLM["LLM: OpenAI / Anthropic"]

    User <--> Clients
    Clients <--> Fastify
    Clients <--> EventBus
    
    Fastify <--> Database
    Orchestrator <--> Database
    
    Orchestrator --> SDK
    SDK --> Config
    
    Orchestrator <--> LLM
    Orchestrator --> ApprovalService
    ApprovalService <--> EventBus
    
    Orchestrator --> Tools
    Tools --> Workspace
```

## Build

```bash
bun install
bun --cwd apps/api run build
bun --cwd apps/api run typecheck
```

## Entry Points

- `src/main.ts` boots the server and prints startup status.
- `src/server.ts` builds the Fastify app.
- `src/transport/*` handles HTTP and realtime transport.
- `test/*` covers the API runtime behavior.

## Team Config Sync

The daemon now treats `ujima.config.*` as a first-class source of truth for
config-managed org state.

- Resolution order is `UJIMA_TEAM_CONFIG` -> `ujima.config.ts` -> `ujima.config.js`.
- The daemon reconciles config once at startup and watches the config directory
  for saves to rerun reconcile automatically.
- Reconcile updates config-owned organization fields, agents, channels, and
  providers without deleting user-generated state.
- Removing an agent from config sets `members.retired_at`; removing a channel
  from config sets `channels.archived_at`.
- Archived config-managed channels reject new messages, and retired
  config-managed agents cannot be assigned new runs or task promotions.
- Config-owned fields are tracked with per-field ownership metadata so future
  dashboard edits can reject writes to code-owned settings.

## Messaging Substrate

The org messaging layer now supports persistent channels, DMs, self-channels,
typed mentions, and archive-backed history search.

- Every member gets a private `self` channel at spawn time. `self.note` writes
  there directly and is always allowed, even when broader channel permissions
  are restricted.
- New agent members are auto-added to `#general` and their role channel so they
  appear in the shared org conversation graph immediately.
- Native channel tools (`channel.post`, `channel.reply`, `channel.dm`,
  `channel.list`, `channel.read`) run inside the orchestrator and are policy
  checked through the `channels` pseudo-tool surface. `channel.dm` lazily
  creates a DM on first send and reuses it afterward.
- `channel.list({ scope: 'all' })` excludes other members' self-channels.
  Self-channels stay private to their owner outside audit/admin access.
- Message posting now records typed `message_mentions` rows and parses
  `@display_name` handles. Mentioned agent members receive `member.alerted`
  realtime events and can wake to reply in the same channel.
- Self-mentions are suppressed, and mention fan-out is throttled to 10 alerts
  per minute per agent per org. When throttled, the runtime emits a
  `member.alert_throttled` system message in `#general`.
- Message edits and deletes are append-only tombstones via `edited_at` and
  `deleted_at`. Immutable tool-call payloads are preserved even if the prose is
  edited later.
- `general`, `group`, and `task-run` channels default to 90-day retention.
  Expired rows are archived to
  `$UJIMA_HOME/archives/channels/<organization_id>/<channel_id>/<YYYY-MM>.jsonl`,
  and `channel.read(query=...)` still searches archived content through the
  sidecar archive index.

## Workspace Boundary Enforcement

Workspace-root hardening is now enforced at both the REST surface and the
daemon's internal filesystem boundaries.

- Any task, member, channel, run, approval-resume, or organization mutation
  before an organization's workspace root exists returns
  `ERR_NO_WORKSPACE_ROOT` with HTTP `409`.
- Filesystem reads and writes are resolved through a realpath-aware resolver,
  so `..` traversal and symlink escapes are rejected with `ERR_PATH_ESCAPE`
  and HTTP `403` semantics in daemon/tool flows.
- `workspace_members.role_scope_paths` is the runtime allowlist for
  member-scoped filesystem access. Role-scoped members can only touch paths
  inside those subtrees.
- Shell execution is scoped the same way as filesystem access: both `cwd` and
  path-like arguments are normalized through the member's workspace resolver
  before spawn.
- MCP calls also sanitize path-bearing arguments before crossing into external
  tool processes. Org-mode flows use member scope paths; legacy task/runtime
  flows fall back to workspace-root enforcement unless narrower agent scopes
  are available.
- Onboarding and config sync seed `workspace_members` rows for known members,
  and missing rows are lazily backfilled on first scoped-path resolution.

## Dependencies

The API is wired to the merged runtime packages, including `@ujima/agent-runtime`, `@ujima/api-schema`, `@ujima/client-sdk`, `@ujima/context-store`, `@ujima/event-bus`, `@ujima/llm`, `@ujima/mcp-client`, `@ujima/orchestrator`, `@ujima/permissions`, `@ujima/runtime-core`, and `@ujima/shared`.

## Notes

- Keep shell and file operations inside the workspace root.
- Provider secrets stay local.
- Do not move orchestration logic into the web app or extension.
