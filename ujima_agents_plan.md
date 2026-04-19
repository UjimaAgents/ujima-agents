# Phase 1 Plan: Ujima Local-First Agent Team Framework

## Summary
Build phase one as a local-first monorepo with four deliverables that ship together:

- `ujima` CLI: one command bootstrap/start experience for a local install, with optional Docker mode.
- Local web control plane: Next.js app that feels like Slack for agents, built from `shadcn/ui` and AI SDK UI primitives.
- VS Code extension: an additional client surface for agents inside VS Code and VS Code-compatible editors like Cursor.
- Node framework package: a code-first npm package exposing declarative `AgentTeam({...})` configuration that defines roles, channels, tools, providers, policies, and the organization workspace root.

Phase one optimizes for solo developers and small teams on a single machine. The machine owner is the admin. Secrets stay in the local backend, never the browser or extension. The UI is not the source of truth for system definition; the package config is. The web app and extension are operating surfaces for the same local backend.

## Implementation Changes
### Product shape
- Local-first only for phase one, but keep a clean split between control plane and runner so hybrid/server mode can come later without rewriting core concepts.
- Model the product as an organization of persistent agent members, not temporary one-off agents.
- Ship preset roles out of the box: `frontend-engineer`, `backend-engineer`, `pm`, `code-reviewer`, `engineering-manager`, `qa-engineer`.
- Support custom roles in phase one via clone/edit of presets, including instructions, provider binding, tool capability profile, and optional subpath restrictions under the org root folder.
- Treat the web app and VS Code extension as two UI layers over the same org, channels, runs, approvals, and memory.

### Core UX
- Main UX is Slack-like:
  - general channel exists by default
  - agent join events are announced in-channel
  - channels support `@mentions`
  - agents are only alerted in group channels when tagged
  - every member and agent has a direct-message thread
  - agents retain cross-conversation memory as persistent org members
- Start with channels and DMs, not workflow boards.
- Use AI SDK UI for streaming messages, tool-call states, approvals, and agent output rendering in the web app.
- Use `shadcn/ui` for app shell, navigation, drawers, dialogs, forms, and settings.
- Onboarding must require selecting the organization root folder before agents can execute tools.
- VS Code extension should surface:
  - agent chat and channel views
  - mentions and DM threads
  - approval prompts
  - run status and tool activity
  - workspace-aware agent actions tied to the opened folder

### Framework/package API
- Ship a Node package as the primary developer surface.
- Primary API is declarative config:
  ```ts
  const team = AgentTeam({
    name: "Acme Product Team",
    workspace: {
      root: "/absolute/path/to/org-folder",
      roleScopes: {
        "frontend-engineer": ["apps/web"],
        "backend-engineer": ["apps/api"]
      }
    },
    providers: {...},
    roles: [...],
    channels: [...],
    policies: {...},
    tools: {...}
  })
  ```
- Code-defined config is the source of truth in phase one.
- UI clients can inspect, validate, run, and lightly manage the configured team, but do not own bidirectional sync.
- Keep the API flat and explicit; avoid builder-heavy abstractions in phase one.

### Architecture
- Monorepo:
  - `apps/web`: Next.js frontend
  - `apps/api`: Node backend
  - `apps/vscode-extension`: VS Code extension
  - `packages/ujima`: framework package with `AgentTeam`
  - `packages/cli`: `ujima` CLI
  - `packages/shared`: shared schemas/types
- Choose a simple Node backend stack, optimized for streaming and fewer layers:
  - Fastify for API
  - `socket.io` for realtime channels, DMs, presence, approvals, and live run events
  - SQLite for local persistence
  - Drizzle or similarly simple typed SQL layer
- Use the AI SDK in the API orchestration layer as the agent runtime engine:
  - provider/model routing
  - streaming
  - tool calling
  - multi-step agent execution loops
  - structured generation where needed
- Do not build a custom low-level orchestration engine in phase one.
- Keep Ujima-specific orchestration in the API around the AI SDK:
  - config loading and validation
  - org/member/channel state
  - task routing between agents
  - approval gating
  - audit log
  - memory persistence
  - provider binding per role
  - local tool execution and MCP bindings
  - enforcement of organization root-folder boundaries
- Build the extension on the standard VS Code extension API so it works in VS Code and compatible forks like Cursor where extension compatibility exists.

### Workspace security model
- Each organization must have exactly one assigned workspace root folder.
- The folder is selected during onboarding in CLI or first-run setup and stored in org config.
- All filesystem, shell, git, artifact generation, and MCP-exposed local path operations must resolve inside that root.
- Phase one allows optional per-role subpath restrictions inside the org root, but never multiple unrelated roots.
- Normalize and validate paths at the backend boundary; reject any traversal or symlink escape that resolves outside the org root.
- The web app and extension both delegate privileged actions to the local backend; neither holds provider secrets or bypasses workspace policy.
- This root-folder model is the basis for later Docker bind mounts and isolated runner containers.

### Data model
- Core entities for phase one:
  - organization
  - organization workspace
  - member
  - role template
  - custom role
  - channel
  - channel membership
  - conversation thread
  - message
  - agent run
  - tool capability profile
  - provider binding
  - approval request
  - memory entry
  - audit event
- Persistent agent identity is first-class. A role instance is a real member with memory, presence, and conversation history.

### Providers and models
- BYOK from day one.
- Support multiple providers and multiple keys per local workspace.
- Allow different agents to bind to different providers/models.
- Route all provider traffic through the local backend using AI SDK abstractions.
- Phase one should support at least OpenAI, Anthropic, and Gemini via AI SDK-compatible provider adapters.

### Tools, MCP, and approvals
- Tool scope for phase one:
  - local filesystem
  - local repo context
  - shell/command execution
  - git actions
  - MCP server bindings
- Tools are assigned per role through capability profiles; no generic full-access tool bag.
- Reads/searches can run without approval.
- Sensitive actions require human approval in the UI:
  - file writes
  - shell commands
  - git branch/commit/PR actions
- Keep tool definitions declarative and schema-validated. No dynamic execute-config-as-code path anywhere.
- Every tool invocation that touches the local machine must be checked against the org root-folder policy before execution.

### Agent Skills Library
- Do not invent a proprietary Ujima-only skill format.
- Support the open `SKILL.md` standard so users can seamlessly adopt existing open-source agent skills (e.g., from awesome-agent-skills libraries).
- Allow users to add skills from these open-source libraries to agents, teams, or organizations they create.
- Add a thin Ujima management layer on top for installation, trust, workspace scoping, and permission gating.

### Memory and audit
- Layered memory in phase one:
  - run memory: transcript, tool events, outputs
  - workspace memory: summaries, conventions, project notes
- Audit every sensitive action:
  - who or which agent initiated it
  - tool invoked
  - approval status
  - diff or result summary
  - provider/model used
  - token/cost metadata where available
  - workspace path touched

### CLI
- Rename product/command to `ujima`.
- Phase one CLI responsibilities:
  - bootstrap local project
  - prompt for and validate the organization root folder
  - install/configure sample app
  - generate starter `AgentTeam` config
  - start frontend and backend locally
  - set up the VS Code extension for local connection
  - offer optional Docker mode
- Native local runtime is primary; Docker is optional.
- Initial flow should feel like:
  - `npx ujima@latest`
  - choose organization name
  - select org root folder
  - prompt for provider keys and sample project setup
  - generate config
  - launch local backend and frontend
  - connect the extension to the same local backend

## Test Plan
- Config loading tests:
  - valid `AgentTeam` config boots correctly
  - invalid roles/tools/providers fail with useful errors
  - invalid workspace root or out-of-root role scopes are rejected
- Role/tool policy tests:
  - role can read allowed resources
  - role cannot use unassigned tools
  - write-capable tools always create approval requests
  - role subpath restrictions are enforced inside the org root
- Workspace boundary tests:
  - path traversal attempts are blocked
  - symlink escapes are blocked
  - shell, git, and file tools cannot operate outside the org root
- Conversation tests:
  - agent join announcement appears in general channel
  - `@mentions` alert only tagged agents in channels
  - DM threads route directly to target agent/member
- Realtime tests:
  - `socket.io` rooms map correctly to channels and DMs
  - reconnect restores live state without duplicating events
  - approvals and run-state events fan out to the right clients
- Extension tests:
  - extension connects to the local backend
  - channel and DM state stays in sync with the web app
  - approval prompts in the extension trigger the same backend flow as the web UI
  - workspace actions in the extension respect the selected org root
- Provider tests:
  - multiple providers can coexist in one workspace
  - different agents can use different models in one org
  - AI SDK orchestration respects per-role provider bindings
- Local persistence tests:
  - agents, channels, memory, audit logs, and workspace config survive restart
- End-to-end local tests:
  - CLI bootstrap creates a runnable sample system
  - web app connects to backend and receives streamed agent events through `socket.io`
  - extension connects to the same backend and reflects shared org state
  - approval flow gates file write, shell, and git actions correctly
  - all generated work stays inside the selected organization folder

## Assumptions And Defaults
- Frontend is Next.js.
- Backend is Node, with a simple Fastify-style architecture rather than a heavier framework.
- Realtime transport is `socket.io`, not raw WebSockets or SSE.
- AI SDK is the orchestration engine inside the API; Ujima only adds product-specific coordination and policy logic around it.
- Local phase one is single-owner, not true multi-user auth.
- SQLite is the only supported datastore in phase one.
- UI foundation is `shadcn/ui` plus AI SDK UI for the web app.
- The VS Code extension is another client of the same local backend, not its own orchestration/runtime layer.
- The framework package is the authoritative configuration layer; the UI clients are operating surfaces and validation layers.
- Each organization has one required root folder chosen during onboarding.
- Folder boundaries are hard-enforced in phase one, with optional per-role subpath restrictions inside that root.
- Persistent org members are the default agent model.
- Preset roles ship first, with clone/edit customization available in the UI and config.
- Hybrid/server mode is intentionally deferred, but the control-plane/runner split and root-folder model are preserved so phase two can add containerized runners cleanly.
