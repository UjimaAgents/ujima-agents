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
- Config-owned fields are tracked with per-field ownership metadata so future
  dashboard edits can reject writes to code-owned settings.

## Dependencies

The API is wired to the merged runtime packages, including `@ujima/agent-runtime`, `@ujima/api-schema`, `@ujima/client-sdk`, `@ujima/context-store`, `@ujima/event-bus`, `@ujima/llm`, `@ujima/mcp-client`, `@ujima/orchestrator`, `@ujima/permissions`, `@ujima/runtime-core`, and `@ujima/shared`.

## Notes

- Keep shell and file operations inside the workspace root.
- Provider secrets stay local.
- Do not move orchestration logic into the web app or extension.
