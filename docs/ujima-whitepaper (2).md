# Ujima — Collective Work, Collective Intelligence
## Whitepaper · Technical Specification · Feature Documentation

> *Ujima (oo-JEE-mah): The third principle of Kwanzaa. Collective work and responsibility — to build and maintain our community together, and to make our community's problems our problems, and to solve them together.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [The Vision: An Agent Operating System](#3-the-vision-an-agent-operating-system)
4. [Core Concepts](#4-core-concepts)
   - 4.1 The Orchestrator (Manual + Auto modes)
   - 4.2 Agents
   - 4.3 MCP Servers — Separate Servers, Multiple Agents Each
   - 4.4b Execution Mode — Concurrent vs Slim
   - 4.5 Shared Context Store
   - 4.6 Event Bus
   - 4.7 Governance Layer
5. [System Architecture](#5-system-architecture)
6. [The Agent Model](#6-the-agent-model)
7. [Communication & Coordination](#7-communication--coordination)
7b. [Concurrent Execution & Conflict Resolution](#7b-concurrent-execution--conflict-resolution) *(Conflict resolution: v1)*
8. [Governance Layer](#8-governance-layer)
9. [Feature Specifications](#9-feature-specifications)
10. [User Flows](#10-user-flows)
11. [MVP Scope](#11-mvp-scope)
12. [Roadmap](#12-roadmap)
13. [Open Questions & Design Decisions](#13-open-questions--design-decisions)

---

## 1. Executive Summary

**Ujima** is a VS Code plugin that transforms a developer's editor into a multi-agent orchestration environment. It allows any number of AI agents — each connected to a domain-specific MCP (Model Context Protocol) server — to be onboarded, assigned roles, given permissions, and set to work together on a shared task.

The architecture is built on two interlocking ideas. First, **each domain has its own dedicated MCP server** — a Figma MCP, a Playwright MCP, a DB MCP — each a fully independent interface to its tool. Second, **each of those MCP servers supports multiple simultaneous agent connections**, so a domain can be staffed by a team, not a single agent. The Figma MCP is connected to both a Senior Designer agent and a Junior Designer agent at the same time. The Playwright MCP is connected to both a Senior QA agent and a Junior QA agent at the same time. All domain teams run concurrently — not waiting on each other, but publishing their outputs to a shared context store that every agent reads in real time.

Ujima provides three things the current agent ecosystem entirely lacks:

- **A standard onboarding interface** — any MCP-compatible agent can be registered and configured without custom integration work.
- **Structured multi-agent collaboration** — agents share context, communicate peer-to-peer, and hand off work through an event-driven backbone that survives long-running tasks.
- **A governance and permissions layer** — a central control room where team leads, security engineers, or product owners can see exactly what every agent did, constrain what tools they can use, and kill a runaway process.

The target users are developers, engineering teams, and open source contributors who want to use AI agents collaboratively — not just as individual copilots, but as a coordinated workforce with real accountability.

---

## 2. Problem Statement

### 2.1 Agents today are isolated

AI coding tools — Cursor, GitHub Copilot, Cline, Claude Code — are powerful individually. But they operate in silos. Each agent knows only what is in its context window. When a developer needs a Figma-aware agent to inform a test-writing agent, the handoff is manual: copy a component name, paste it into another prompt, hope nothing gets lost.

There is no shared memory. No handoff protocol. No feedback loop.

### 2.2 Integration is bespoke and brittle

Every agent integration is built from scratch. Teams write custom glue code to connect agents to their tools. When a new MCP server is published, there is no standard way to say "register this with my agent setup and give it the right permissions." Each configuration is a one-off — fragile, undocumented, non-transferable.

### 2.3 There is no control room

When an agent fails, causes unexpected side effects, or runs for hours producing nothing, there is no central place to see what happened. No audit log of tool calls. No way to revoke permissions mid-run. No kill switch that doesn't involve closing a terminal window.

Enterprise teams cannot adopt agentic workflows without governance. The absence of a governance layer is the primary reason AI agents remain a developer toy rather than a team-level capability.

### 2.4 Agent roles don't exist

Today, every agent is given the same shape: a system prompt, a set of tools, a model. There is no concept of seniority, responsibility, or review hierarchy. No agent is a junior that escalates to a senior. No agent is a reviewer that signs off before work proceeds downstream.

The result is that multi-agent workflows either run in parallel with no coordination, or run sequentially through a single orchestrator with no specialisation.

---

## 3. The Vision: An Agent Operating System

Ujima is not a tool. It is an **operating system for agent teams**, built where developers already live.

The core metaphor is the **open claw**: each MCP server is a claw — a live interface to a domain tool. Multiple agents can grip the same claw at the same time, each with their own role and permission scope.

A developer opens Ujima, describes a product to build, and the system spins up a team. Not a queue of tasks — a team working in parallel. The Senior Designer and Junior Designer are both connected to the Figma MCP from the start. The Senior QA and Junior QA are both connected to the Playwright MCP from the start. The DB agent is reading schema simultaneously.

Nobody waits for a handoff. The Junior Designer creates frames; those frames appear in the shared context store as they are produced. The QA agents see them and begin drafting tests immediately. The Senior Designer reviews and approves in real time — not at the end of a pipeline, but as a concurrent participant. The Senior QA reviews test output the same way.

The orchestrator is not a conveyor belt. It is a coordinator — watching all agents simultaneously, resolving conflicts, and surfacing decisions that require the developer's judgment.

---

## 4. Core Concepts

### 4.1 The Orchestrator

The orchestrator is the brain of the system. It receives a task, decomposes it, determines which agents to engage, spawns them when needed, monitors progress, and synthesises the final output. It never executes tool calls directly — it delegates to agents.

The orchestrator is model-agnostic: it runs on any LLM connected to the developer's editor — local via Ollama, hosted via API, or bundled with the IDE.

**The orchestrator runs in one of two modes, selectable per task:**

**Manual mode — developer-defined teams.** The developer pre-configures agents with specific roles, personas, and permissions. The orchestrator reads the registered team, assigns sub-tasks to the appropriate agents, and coordinates their work. The developer controls exactly who is on the team and what they can do.

**Auto mode — orchestrator-generated roles.** The developer provides only a task description. The orchestrator analyses the task, determines what domains and roles are needed, generates agent definitions on the fly (persona, permissions, escalation rules), and assembles a team. Generated agents are ephemeral by default but can be saved to the registry for reuse. Auto mode is the fastest path — zero configuration required.

> **Auto-mode implementation phases.** v0.1 MVP ships a **template-matching router**: keyword patterns in the task prompt map to preset teams (e.g. "design + build" → Sr/Jr Designer + Sr/Jr Engineer + DB Agent). When no preset matches confidently, Ujima falls back gracefully — it tells the developer "I can't confidently pick a team for this prompt; use manual mode or rephrase" rather than guessing wrong. **Full LLM-based role inference** — where the orchestrator generates novel personas and permissions from first principles — arrives in v0.2. The UX surface is identical in both phases; only the routing engine changes.

Both modes share the same execution engine, event bus, and context store. The only difference is how the team is assembled before execution begins.

**Agent lifecycle — spawn on demand, not always on.** Agents are not persistent running processes. An agent is a definition — a persona, a permission set, a model reference. The orchestrator spawns an agent process only when it has work for that agent, passes it the relevant context from the store, receives the output, and the process exits. The context store holds all state between invocations. This keeps resource usage proportional to actual work — 20 registered agents does not mean 20 processes running.

### 4.2 Agents

An agent is an identity bound to a model, a role definition, a set of tool permissions, and a communication channel. Agents do not share context windows — they communicate through the shared context store and the event bus.

Each agent has:

- **A persona** — a system prompt defining its identity, expertise, seniority, and behaviour.
- **A tool permission set** — which MCP tools it can call, and which are blocked.
- **A communication scope** — which events it publishes and subscribes to.
- **An escalation path** — conditions under which it stops and waits for human or senior-agent approval.

### 4.3 MCP Servers — Separate Servers, Multiple Agents Each

Ujima does not use a single shared MCP. Each domain tool runs as its own **independent MCP server**. The Figma MCP is a separate server from the Playwright MCP, which is separate from the DB MCP. Each server is a fully isolated interface to its domain.

What makes Ujima distinct is that each of these separate servers supports **multiple simultaneous agent connections**. A domain is not assigned to one agent — it is staffed by a team:

| MCP Server | Connected Agents | Simultaneous |
|---|---|---|
| Figma MCP | Senior Designer + Junior Designer | Both live from task start |
| Playwright MCP | Senior QA + Junior QA | Both live from task start |
| DB MCP | DB Agent | Live from task start |

Every agent holds a persistent, live connection to its own MCP server. All agents are active at the same time. No domain waits for another domain to finish.

The Junior Designer is creating frames in Figma while the Junior QA is already drafting test scaffolding from the DB schema that the DB agent has published to the shared context store. When the Senior Designer approves a frame, it enters the context store immediately — the QA agents consume it without waiting for a prompt or a pipeline trigger.

The work is **concurrent across independent domains, with internal team structure within each domain**.

### 4.4 The Shared Context Store

The shared context store is a persistent, queryable key-value store that all agents can read and write, subject to their permissions. It is the team's working memory — where the designer deposits design tokens, the DB agent deposits a schema summary, and the Playwright agent picks up both to write accurate tests.

The context store survives individual agent crashes. If an agent is restarted mid-task, it reads the store and continues from where it left off.

### 4.4b Execution mode — concurrent vs slim

Ujima supports two execution modes, switchable per task:

**Concurrent mode (default).** All agents across all MCP domains are spawned and working simultaneously. The fastest path to a result. Best when token cost is not a constraint and speed matters.

**Slim mode — linear, token-efficient.** Agents are spawned one at a time in a defined sequence. Each agent completes its work, writes to the context store, and exits before the next is spawned. No concurrent processes. Significantly lower token usage because agents are not all consuming context at the same time.

```
Concurrent mode:             Slim mode:
────────────────             ──────────
DB Agent    ══════           DB Agent     ══ [exits]
Sr Designer ══════           Jr Designer           ══ [exits]
Jr Designer ══════           Sr Designer                ══ [exits]  
Sr QA       ══════           Jr QA                           ══ [exits]
Jr QA       ══════           Sr QA                                ══ [exits]
```

Slim mode is recommended for: exploratory tasks where you want to inspect output at each stage, cost-sensitive environments, and tasks where one domain's output is a hard dependency for the next with no parallel work possible.

The orchestrator manages the sequencing in slim mode. The developer can also define a custom sequence order in the task config.

### 4.5 The Event Bus

The event bus is the communication backbone. Agents publish events when they complete significant actions. Other agents subscribe to the events they care about. The orchestrator subscribes to all events and uses them to track progress and trigger the next step.

Because agents communicate asynchronously through events rather than directly, a task can run for hours without a single point of failure breaking the chain.

### 4.6 The Governance Layer

The governance layer is the control room — the single authoritative source of truth for what every agent is allowed to do, what it has done, and what the overall state of a running task is. It is implemented as a cloud backend, shared across a team, persistent across sessions.

---

## 5. System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        VS Code Plugin                         │
│  Task Input · Activity Stream · Governance UI · Agent Cards   │
└────────────────────────────┬─────────────────────────────────┘
                             │ task
                             ▼
               ┌─────────────────────────┐
               │    Orchestrator Agent    │
               │  (local, model-agnostic) │
               └──┬──────────┬──────────┬┘
                  │          │          │
         ┌────────▼──┐  ┌────▼────┐  ┌─▼──────────┐
         │Sr Designer│  │Sr QA    │  │ DB Agent   │
         │Jr Designer│  │Jr QA    │  │            │
         └────┬──┬───┘  └───┬──┬──┘  └─────┬──────┘
              │  │          │  │            │
              │  └──────────┘  └────────────┤
              │  (all agents active at      │
              │   the same time)            │
              ▼          ▼                  ▼
        ┌──────────┐ ┌──────────────┐ ┌──────────┐
        │ Figma    │ │ Playwright   │ │ DB MCP   │
        │ MCP      │ │ MCP          │ │          │
        │          │ │              │ │          │
        │ ← Sr Des │ │ ← Sr QA      │ │ ← DB Agt │
        │ ← Jr Des │ │ ← Jr QA      │ │          │
        └──────────┘ └──────────────┘ └──────────┘
              │               │              │
              └───────────────┼──────────────┘
                              │
               ┌──────────────▼──────────────┐
               │    Shared Context Store      │
               │  (all agents read/write)     │
               │  results available instantly │
               └──────────────┬──────────────┘
                              │
               ┌──────────────▼──────────────┐
               │         Event Bus            │
               │  publish as you produce,     │
               │  subscribe to what you need  │
               └──────────────┬──────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    Governance Layer (Cloud)                   │
│    Permissions · Audit Log · Rate Limits · Kill Switch        │
└─────────────────────────────────────────────────────────────┘
```

**The key principle:** every agent is live from the moment the task starts. The Junior Designer is creating frames in Figma while the Junior QA is already drafting test scaffolding from whatever schema and design context is already in the store. When the Senior Designer approves a frame, it appears in the context store immediately — the QA agents consume it without waiting for a prompt. Work flows continuously across all domains at once.

### 5.1 Local-first architecture

Ujima runs entirely on your machine. There is no cloud dependency to start using it. Everything — the orchestrator, agent processes, context store, event bus, and MCP connections — runs locally.

Cloud is additive, not required. You connect a cloud workspace when you want two things: team collaboration (shared agent definitions, shared task history) and remote monitoring (watching what agents are doing from outside the VS Code session). The product is fully functional without it.

| Component | Default | Cloud adds |
|---|---|---|
| VS Code plugin | Local | — |
| Orchestrator | Local | — |
| Agent processes | Local | — |
| MCP servers | Local or remote (per MCP) | — |
| Shared context store | Local (SQLite or JSON) | Sync across team members |
| Event bus | Local (EventEmitter) | — |
| MCP Registry | Local config file | Community registry + team-shared configs |
| Governance / monitoring | Local audit log | Remote monitoring dashboard, team-wide audit log |
| Agent definitions | Local JSON files | Shared team registry, versioned |

### 5.2 Technology choices

| Layer | Technology | Rationale |
|---|---|---|
| VS Code plugin | TypeScript, VS Code Extension API | Native, same ecosystem as orchestrator |
| Webview UI (rich panels) | React + Vite | Standard pattern used by Cursor, Continue, Cline; fast dev loop, rich component ecosystem for activity streams, governance panels, and onboarding wizards |
| Sidebar UI | Native VS Code TreeView | Keeps the always-visible agent list feeling native; matches VS Code navigation conventions |
| Monorepo tooling | pnpm workspaces + Turborepo | One git repo for plugin, orchestrator, agent runtime, and shared types; avoids npm publish steps for internal packages; Turbo caches build/test across packages |
| Orchestrator runtime | Node.js (TypeScript) | Event loop is ideal for concurrent async agent streams; MCP SDK is TypeScript-native |
| Agent processes | Node.js child processes | Crash isolation, independent restart, same runtime |
| Context store | SQLite (local, zero config) | File-based, no server required, fast for local use |
| Event bus | Node.js EventEmitter (local) | Zero dependencies for local mode |
| MCP client | `@modelcontextprotocol/sdk` (official TypeScript) | One canonical client; same SDK the MCP spec authors maintain; supports stdio, SSE, and streamable HTTP transports |
| MCP connection | JSON config paste or registry | Same pattern as Claude desktop MCP config |
| LLM abstraction | Vercel AI SDK + first-class `vscode.lm` adapter | Vercel AI SDK unifies streaming across Anthropic, OpenAI-compatible, Ollama, and others; the `vscode.lm` adapter lets Ujima use the user's already-active chat model (Copilot, etc.) with zero API-key configuration — the "use whatever chat is already in my editor" path |
| Provider selection order | `vscode.lm` → configured API → Ollama | Zero-config default; falls back gracefully when the host chat model is unavailable or rate-limited |
| Testing | Vitest (unit) + Playwright (e2e, via `@vscode/test-electron`) | Vitest is fast, ESM-native, parity with the dev runtime; Playwright codegen accelerates webview test authoring |
| Cloud sync (optional) | Node.js + PostgreSQL | Team workspace, shared agent registry |
| Remote monitoring (optional) | WebSocket stream to cloud dashboard | Watch agent activity outside VS Code |

---

## 6. The Agent Model

### 6.1 Agent definition schema

```json
{
  "id": "figma-senior-designer",
  "name": "Senior Designer",
  "persona": "You are a senior product designer with 8 years of experience. You establish the design system, make architectural decisions about component structure, and review work produced by junior designers before it proceeds to engineering. You never implement details when a design system decision is needed first.",
  "model": "local/ollama:llama3",
  "mcp": "figma",
  "permissions": {
    "allowed_tools": ["get_file", "get_components", "get_styles", "create_frame", "update_frame", "delete_frame"],
    "blocked_tools": [],
    "rate_limit": { "calls_per_minute": 30, "max_session_tokens": 50000 }
  },
  "communication": {
    "publishes": ["design_system_ready", "frame_approved", "review_required"],
    "subscribes": ["task_assigned", "junior_frame_ready"]
  },
  "escalation": {
    "conditions": ["conflicting_design_direction", "unclear_requirements"],
    "escalate_to": "human"
  },
  "seniority": "senior",
  "reports_to": "orchestrator",
  "reviews": ["figma-junior-designer"]
}
```

```json
{
  "id": "figma-junior-designer",
  "name": "Junior Designer",
  "persona": "You are a junior product designer. You implement UI designs strictly within the design system established by the senior designer. You never introduce new components, colours, or typographic choices. When unsure, you flag and wait. You do not delete existing components.",
  "model": "local/ollama:llama3",
  "mcp": "figma",
  "permissions": {
    "allowed_tools": ["get_file", "get_components", "get_styles", "create_frame", "update_frame"],
    "blocked_tools": ["delete_frame", "delete_component", "update_styles"],
    "rate_limit": { "calls_per_minute": 20, "max_session_tokens": 30000 }
  },
  "communication": {
    "publishes": ["junior_frame_ready", "clarification_needed"],
    "subscribes": ["design_system_ready", "task_assigned", "revision_requested"]
  },
  "escalation": {
    "conditions": ["ambiguous_requirement", "missing_design_token"],
    "escalate_to": "figma-senior-designer"
  },
  "seniority": "junior",
  "reports_to": "figma-senior-designer"
}
```

### 6.2 Same MCP, different behaviour

The Figma MCP exposes the same set of tools to both agents. What changes is the permission wrapper Ujima applies before any tool call reaches the MCP:

```
Agent makes tool call
        ↓
Ujima permission middleware
        ↓
Is tool in agent's allowed_tools?
        ├── YES → forward to MCP, log to audit
        └── NO  → block, log to audit, notify orchestrator
```

The MCP server does not need to know about agent roles. Governance logic lives entirely in Ujima.

### 6.3 Seniority and concurrent review

Senior and junior agents on the same MCP are active at the same time. The junior is not blocked waiting for the senior to define things before starting — it works with whatever context is already in the store, and updates its output reactively as the senior publishes decisions.

The senior's role is continuous oversight, not a final gate:

```
[Both agents active simultaneously from task start]

Junior Designer → creating frames in Figma, publishing to context store as each is ready
Senior Designer → monitoring context store, reviewing frames as they arrive
Senior Designer → publishes: frame_approved (unblocks QA agents for that frame)
Senior Designer → publishes: revision_requested (junior updates that specific frame)
Junior Designer → revises specific frame, republishes

[QA agents are already working with already-approved frames — they do not wait]
```

The orchestrator tracks the approval state of each unit of work. Downstream agents (Playwright) consume approved outputs immediately as they become available, not after all design work is complete. The pipeline is a **graph of parallel streams**, not a sequence of stages.

---

## 7. Communication & Coordination

### 7.1 Event bus design

Events are structured JSON payloads published to named channels:

```json
{
  "event_id": "evt_01j9x2k4m",
  "type": "junior_frame_ready",
  "publisher": "figma-junior-designer",
  "timestamp": "2025-04-13T10:23:44Z",
  "payload": {
    "frame_id": "1234:5678",
    "frame_name": "Dashboard - Empty State",
    "figma_url": "https://figma.com/file/..."
  },
  "task_id": "task_ujima_001",
  "session_id": "session_2025_04_13"
}
```

All events are persisted to the audit log before delivery to subscribers. The audit log is a complete, ordered history of everything that happened in a session — not a sample.

### 7.2 Shared context store structure

The context store uses namespaced keys to prevent agent collisions:

```
task:{task_id}:status             → running | paused | complete | failed
task:{task_id}:design_system      → JSON blob of design tokens, spacing, colours
task:{task_id}:schema             → Database schema summary from DB agent
task:{task_id}:approved_frames    → List of Figma frame IDs approved by senior designer
task:{task_id}:test_results       → Playwright test output
agent:{agent_id}:last_action      → Timestamp and description of last action
agent:{agent_id}:token_usage      → Running token count for rate limit enforcement
```

### 7.2b Context hydration on agent spawn

Because agents are spawned on demand rather than held as long-lived processes, each spawn is cold — the agent has no in-memory history from its previous invocations. The context store is the sole source of truth for continuity. This creates a trade-off: how much history and cross-domain context should be loaded into the agent's prompt on each spawn?

Ujima takes the **generous hydration** position. On each spawn, the agent runtime loads:

- The agent's persona and the full task description
- All events published in the agent's domain within a recent window (default 30 minutes)
- Every artifact currently marked `approved` in the agent's domain
- Peer-agent outputs referenced by events the agent subscribes to
- The last N audit entries for this specific agent (default 10)

The bundle is compacted to fit the model's context window, prioritising approved artifacts → recent events → older history. Tokens cost more per spawn than a minimal hydration strategy would — the explicit decision is that **agent output quality is worth more than the token saved**. Lean hydration can be enabled per agent for cost-sensitive workflows, but is not the default.

This is the reason spawn-on-demand works at all: the store carries state the process cannot.

### 7.3 Handling long-running tasks

For tasks that run over hours:

- Agents write progress checkpoints to the context store every N actions.
- If an agent process dies, the orchestrator detects it via heartbeat timeout and restarts it.
- On restart, the agent reads its last checkpoint from the context store and continues.
- The event bus retains undelivered events for a configurable window (default: 24 hours).

### 7.4 Conflict resolution

When two agents produce conflicting outputs — for example, the junior designer uses a colour not in the design system — the senior agent raises a `conflict_detected` event. The orchestrator pauses the workflow, surfaces the conflict in the VS Code UI, and waits for resolution — from the senior agent, or from the human developer.

---


---

## 7b. Concurrent Execution & Conflict Resolution

### 7b.1 The concurrency model

When a task starts, the orchestrator does not sequence agents one after another. It activates all registered agents simultaneously and opens a shared workspace — the context store — that all agents can read and write to in real time.

Each domain team (Figma, Playwright, DB) works independently inside its own MCP server. Within each team, the senior and junior agents are both live. The result is a matrix of concurrent activity:

```
Time →

Figma MCP:
  Senior Designer  ══════[monitor]══[review A]══[approve A]══[review B]══════
  Junior Designer  ══[frame A]══════════════════[frame B]══[revise B]═════════

Playwright MCP:
  Senior QA        ══════[monitor]══════════════════════════[review tests]═════
  Junior QA        ══[scaffold]══[test A from schema]══[update with frame A]═══

DB MCP:
  DB Agent         ══[read schema]══[publish]══[respond to queries]════════════

Shared Context Store:
                   ←── all agents write here as they produce
                   ←── all agents read here continuously
```

Nothing is blocked waiting for a stage to complete. The Junior QA does not wait for design to finish — it begins immediately with whatever is in the context store and updates its tests reactively as new approved frames arrive.

### 7b.2 How the orchestrator detects conflicts

The orchestrator subscribes to all events from all agents across all MCP domains. It runs a continuous conflict detection loop — not a final validation, but a live monitor.

**Conflict types:**

| Type | Example | Detection method |
|---|---|---|
| Cross-domain semantic conflict | QA test references a component name the designer has since renamed | Orchestrator compares published entity names across domains |
| Intra-domain contradiction | Junior designer uses a colour the senior designer explicitly banned in the design system | Senior agent raises `policy_violation` event |
| Dependency staleness | Playwright test was written against schema version 1; DB agent publishes schema version 2 with a renamed column | Orchestrator compares schema version in context store against version referenced in test artifact |
| Approval bypass | A downstream agent consumes an output that has not yet been approved by the domain senior | Orchestrator checks approval state before allowing cross-domain context consumption |

**Detection flow:**

```
Agent publishes output to context store
        ↓
Orchestrator receives published event
        ↓
Conflict checker runs:
  ├── Check: does this output reference entities from other domains?
  │     └── YES → verify those entities are approved and current
  ├── Check: does this output contradict any active policy published by a senior agent?
  │     └── YES → raise policy_conflict event
  ├── Check: does any existing downstream artifact depend on the version of context this output changes?
  │     └── YES → raise dependency_stale event
  └── CLEAR → mark output as conflict-free, available for consumption
```

### 7b.3 Conflict resolution protocol

When a conflict is detected, the orchestrator follows a resolution hierarchy before surfacing anything to the developer. Most conflicts are resolvable autonomously.

**Resolution hierarchy:**

```
Conflict detected
        ↓
Level 1 — Autonomous senior resolution
  Can the senior agent in the affected domain resolve this
  without changing the task scope?
        ├── YES → senior agent publishes correction, junior updates
        │         orchestrator re-validates, marks resolved
        └── NO  → escalate to Level 2

Level 2 — Cross-domain senior consensus
  Can the senior agents in the two conflicting domains
  agree on a resolution by publishing to the event bus?
        ├── YES → both publish resolution events
        │         orchestrator applies resolution to context store
        │         affected downstream agents receive update event
        └── NO  → escalate to Level 3

Level 3 — Human review card
  Orchestrator pauses affected streams only
  (unaffected agents continue working)
  Developer receives a structured review card in VS Code:

  ┌─────────────────────────────────────────────────────┐
  │ ⚠ Conflict: Dependency staleness                    │
  │                                                     │
  │ DB Agent published schema v2:                       │
  │   user_name → full_name (renamed)                   │
  │                                                     │
  │ Affected: 3 Playwright tests reference 'user_name'  │
  │                                                     │
  │ Proposed resolution:                                │
  │   Junior QA updates affected tests to 'full_name'  │
  │                                                     │
  │ [Accept]  [Reject]  [Edit resolution]               │
  └─────────────────────────────────────────────────────┘

  Developer approves or edits
        ↓
  Orchestrator applies resolution
  Paused streams resume
  Unaffected streams were never paused
```

### 7b.4 Partial pausing — only what is affected

A critical property of Ujima's conflict resolution is **selective stream pausing**. When a conflict is detected between the DB domain and the Playwright domain, only the Playwright agents are paused. The Figma team continues working. The DB agent continues responding to queries.

This prevents a single conflict from freezing the entire task — which is the failure mode of linear pipelines. In Ujima, a conflict is contained to its blast radius.

```
Conflict: DB schema change breaks Playwright tests

Figma MCP:
  Senior Designer  ════════════════════════ [continues unaffected] ══════════
  Junior Designer  ════════════════════════ [continues unaffected] ══════════

Playwright MCP:
  Senior QA        ══════ [PAUSED — conflict resolution in progress] ══════
  Junior QA        ══════ [PAUSED — conflict resolution in progress] ══════

DB MCP:
  DB Agent         ════════════════════════ [continues, responding to queries] ═

Shared Context:    ════ Figma outputs still flowing ════ DB queries still served ═
```

Once resolution is applied and the Playwright agents resume, they pick up from their last checkpoint in the context store — not from scratch.

### 7b.5 Conflict event schema

```json
{
  "event_id": "evt_conflict_01",
  "type": "conflict_detected",
  "conflict_type": "dependency_stale",
  "detected_by": "orchestrator",
  "timestamp": "2025-04-13T11:42:00Z",
  "affected_agents": ["playwright-junior-qa", "playwright-senior-qa"],
  "affected_streams": ["playwright"],
  "source_event": {
    "event_id": "evt_db_schema_v2",
    "publisher": "db-agent",
    "type": "schema_updated"
  },
  "conflict_detail": {
    "stale_reference": "user_name",
    "current_value": "full_name",
    "affected_artifacts": ["test_user_profile.spec.ts", "test_dashboard_table.spec.ts"]
  },
  "proposed_resolution": {
    "action": "update_references",
    "from": "user_name",
    "to": "full_name",
    "assignee": "playwright-junior-qa"
  },
  "resolution_level": 3,
  "status": "awaiting_human_approval"
}
```

---

## 8. Governance Layer

### 8.1 What governance controls

**Permissions** — what each agent is allowed to do. Defined at registration, modifiable live. Changes take effect on the next tool call.

**Audit log** — a complete, tamper-resistant record of every event, tool call, token usage, and permission check. Queryable by agent, tool, time window, and task.

**Rate limits** — per-agent caps on token usage, tool calls per minute, and maximum session duration. Prevents runaway agents from burning compute budget or flooding an external API.

**Kill switch** — halts a specific agent, an entire team, or a full session immediately. Stops tool calls mid-flight, persists current state to the context store, and marks the session as paused.

### 8.1b Approval routing

When an artifact requires approval before downstream agents can consume it, the question of *who* approves is configurable via `ujima.approvals.mode`:

| Mode | Behaviour | When to use |
|---|---|---|
| `human_all` *(default in v0.1)* | Every approval surfaces to the developer as a review card. Senior agents can propose resolutions but do not silently co-sign. | New teams, high-stakes work, demos where visibility matters |
| `senior_auto` | Senior agents in the affected domain auto-approve their juniors' outputs. Humans only see exceptions — conflicts, escalations, and destructive actions. | Trusted teams running well-scoped tasks |
| `hybrid` | Senior agents auto-approve low-risk outputs; human approval is required for destructive tool calls and cross-domain artifacts. | Day-to-day work once the team has proven itself |

The setting is per-workspace and can be overridden per task. Regardless of mode, **every approval decision is written to the audit log** — no approval is invisible.

### 8.2 Permission levels

| Level | Who sets it | Scope |
|---|---|---|
| Platform defaults | Ujima | Applies to all agents unless overridden |
| MCP-level policy | MCP administrator | Applies to all agents using that MCP |
| Agent-level policy | Team lead / developer | Applies to a specific agent definition |
| Session override | Developer at runtime | Temporary, applies to current session only |

### 8.3 Audit log schema

```sql
CREATE TABLE audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      TEXT NOT NULL,
  event_type    TEXT NOT NULL,       -- tool_call | permission_check | event_published | escalation
  agent_id      TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  tool_name     TEXT,
  tool_input    JSONB,
  tool_output   JSONB,
  allowed       BOOLEAN NOT NULL,
  block_reason  TEXT,
  tokens_used   INTEGER,
  duration_ms   INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 8.4 Governance UI panels

**Agent Status Panel** — live view of all registered agents. Shows current state (idle / active / waiting / blocked), last action, token usage against limit, and a per-agent kill switch.

**Audit Log Panel** — filterable, scrollable log of all events. Exportable as JSON or CSV.

**Permission Editor** — form-based UI for modifying agent permission sets. Changes can be applied to the running session or saved to the agent definition for future sessions.

---

## 9. Feature Specifications

### 9.1 MCP Registry

The MCP Registry is a central catalogue of available MCP servers — a package manager for agent tooling.

**Core features:**

- Browse and search MCP servers by name, category, and capability.
- One-click registration: add an MCP to a project and configure connection parameters.
- Version pinning: pin an MCP to a specific version for reproducible agent behaviour.
- Capability manifest: each registered MCP declares its tools, input/output schemas, and required permissions.
- Community contributions: open source MCP servers can be submitted to the registry.

**Registry entry schema:**

```json
{
  "id": "mcp-figma",
  "name": "Figma MCP",
  "version": "1.2.0",
  "description": "Connect agents to Figma files, components, styles, and frames.",
  "category": "design",
  "connection": {
    "type": "sse",
    "url": "https://mcp.figma.com/sse",
    "auth": "oauth2"
  },
  "tools": [
    { "name": "get_file", "description": "Read a Figma file by ID", "destructive": false },
    { "name": "create_frame", "description": "Create a new frame", "destructive": false },
    { "name": "delete_frame", "description": "Delete a frame permanently", "destructive": true }
  ],
  "default_permissions": {
    "safe_tools": ["get_file", "get_components", "get_styles"],
    "destructive_tools": ["delete_frame", "delete_component"]
  }
}
```

### 9.2 Agent Onboarding

Onboarding an agent is the core UX of Ujima. It should take under two minutes.

**Onboarding steps:**

1. **Connect an MCP** — three ways:
   - Browse the built-in registry and click to register
   - Paste an MCP JSON config directly (same format as Claude desktop `mcpServers` config):
     ```json
     {
       "mcpServers": {
         "figma": {
           "command": "npx",
           "args": ["-y", "figma-mcp"],
           "env": { "FIGMA_TOKEN": "your-token-here" }
         }
       }
     }
     ```
   - Provide a custom SSE URL for a remote MCP server
2. **Name the agent and set its role** — Senior Designer, Junior QA, DB Analyst, etc.
3. **Write or select a persona** — a system prompt defining behaviour, seniority, and constraints. Templates provided for common roles. In auto mode, the orchestrator generates this.
4. **Choose a model** — select from models available in the connected IDE or provide an API key for any OpenAI-compatible endpoint.
5. **Configure permissions** — choose from a preset (read-only, read-write, full access) or customise per-tool. Destructive tools are flagged clearly.
6. **Set escalation rules** — conditions under which the agent stops and flags for human or senior-agent review.
7. **Test connection** — Ujima spawns the agent with a test prompt, fires a test tool call, shows the result.
8. **Save** — to local config (default) or to team registry (cloud).

### 9.3 Agent Team Configuration

Agents are assembled into teams for a task. A team definition specifies which agents participate, who orchestrates, and what human review is required before critical actions.

```json
{
  "team_id": "team_product_build_01",
  "name": "Product Build Team",
  "agents": [
    "figma-senior-designer",
    "figma-junior-designer",
    "db-agent",
    "playwright-agent"
  ],
  "orchestrator": {
    "model": "local/ollama:llama3",
    "max_task_duration_hours": 4,
    "human_review_required_before": ["production_deploy", "database_migration"]
  }
}
```

Teams can be saved, versioned, and shared. A team is a reusable template — spin it up for a new task without reconfiguring from scratch.

### 9.4 Task Interface

**Input modes:**

- Natural language prompt — describe the task in plain English. The orchestrator decomposes it.
- Structured task file — a YAML or JSON file describing sub-tasks, dependencies, and agent assignments.
- VS Code command — trigger a task from the command palette with context from the current file or selection.

**Output display:**

- Activity stream — real-time, chronological log of agent actions.
- Agent cards — per-agent summary of current state, last action, and token usage.
- Human review queue — pending items requiring developer approval before the workflow continues.
- Result panel — final synthesised output from the orchestrator.

### 9.5 Governance UI

| View | What it shows |
|---|---|
| Live agents | Status, current action, tokens used, kill switch per agent |
| Audit log | All events in the session, filterable and exportable |
| Permission editor | Per-agent permission sets, editable live |
| Rate limit dashboard | Token usage, call frequency, budget remaining |
| Session history | Past sessions, their outcomes, and their full audit logs |

---

## 10. User Flows

### 10.1 First-time setup

```
Install Ujima plugin from VS Code marketplace
        ↓
Connect to Ujima cloud (governance) or run fully local (MVP mode)
        ↓
Select a model: local (Ollama) or API key (OpenAI-compatible)
        ↓
Browse MCP Registry → select Figma MCP
        ↓
Configure MCP connection (OAuth / API key)
        ↓
Walk through agent onboarding flow
        ↓
Agent saved. Agent card visible in sidebar.
        ↓
Setup complete. Create a task.
```

### 10.2 Running a multi-agent task

```
Developer opens task panel
        ↓
Types: "Design and build a payroll summary dashboard.
        Use the existing DB schema.
        Write Playwright tests for the table component."
        ↓
Orchestrator receives task
        ↓
All agents activated simultaneously:

  Figma MCP          DB MCP           Playwright MCP
  ─────────          ──────           ──────────────
  Jr Designer →      DB Agent →       Jr QA →
  starts frames      reads schema,    starts test
                     writes to store  scaffolding from
  Sr Designer →                       whatever is in store
  monitors, reviews
  as frames arrive   [schema now      Sr QA →
                     available to     reviews tests as
  [frame approved]   all agents]      they are written
       ↓
  Jr QA updates      [Jr QA picks up approved frame,
  tests for that     refines tests immediately]
  frame immediately
        ↓
Activity stream shows all agents working in real time
        ↓
Human review card appears when Senior Designer flags a decision
that requires developer input — not at the end, but mid-flow
        ↓
Developer approves. Agents continue.
        ↓
Orchestrator synthesises final output when all streams are complete:
design links, test coverage report, schema diff
```

### 10.3 Onboarding a new agent mid-task

```
Task is running. Developer realises a linting agent is needed.
        ↓
Opens MCP Registry → finds ESLint MCP
        ↓
Creates "Linting Agent" with read + report permissions (no write)
        ↓
Agent added to running team
        ↓
Developer sends instruction:
  "Have the linting agent review generated code before tests run"
        ↓
Orchestrator inserts linting step into task graph
        ↓
Linting agent runs → publishes lint_report event
        ↓
Playwright agent subscribes to lint_report → proceeds
```

### 10.4 Using the kill switch

```
Activity stream shows DB agent looping — same query, 847 calls in 3 minutes
        ↓
Developer opens Governance → Live Agents view
        ↓
Sees DB agent rate limit breached (limit: 30/min)
        ↓
Clicks Kill on DB agent
        ↓
Governance layer blocks all further tool calls from DB agent
        ↓
Current state flushed to context store
        ↓
Orchestrator receives agent_killed event → pauses dependent sub-tasks
        ↓
Developer reviews audit log to diagnose the loop
        ↓
Fixes escalation rule on DB agent definition
        ↓
Restarts DB agent — reads context store, continues from last valid checkpoint
```

### 10.5 Team member accessing shared agents

```
New engineer joins the team
        ↓
Installs Ujima plugin → connects to team's cloud workspace via invite link
        ↓
All shared agent definitions, MCP registrations, and team configs sync automatically
        ↓
Engineer runs a task — same agents, same permissions, same governance rules as team lead
```

---

## 11. MVP Scope

The MVP is fully local — no cloud dependency. It proves the core loop: manual and auto orchestrator modes, multiple independent MCP servers each staffed by a role-differentiated agent team, concurrent and slim execution modes, and a local governance log.

### 11.1 MVP components

| Component | Included | Notes |
|---|---|---|
| VS Code plugin shell | ✅ | Activity stream, task input, agent cards |
| Orchestrator — manual mode | ✅ | Developer-defined agent teams |
| Orchestrator — auto mode | ✅ | Orchestrator generates roles from task description |
| MCP JSON paste (Claude-style) | ✅ | Paste mcpServers JSON to connect any MCP instantly |
| MCP Registry (local, curated) | ✅ | Browse and one-click register MCPs |
| Agent onboarding flow | ✅ | Full UI with persona templates |
| Separate MCP servers, multi-agent | ✅ | Figma MCP → Sr + Jr Designer; Playwright MCP → Sr + Jr QA |
| Agent spawn-on-demand lifecycle | ✅ | Spawned when needed, exits when done — no idle processes |
| Concurrent mode | ✅ | All agents active simultaneously across domains |
| Slim mode | ✅ | Sequential execution for token efficiency |
| Shared context store | ✅ | Local SQLite, zero config, no server required |
| Event bus | ✅ | Node.js EventEmitter (local) |
| Local audit log | ✅ | Complete record of all spawns, tool calls, events |
| Permission middleware | ✅ | Per-agent allow/block list |
| Kill switch | ✅ | Per-agent and full-session halt |
| Cloud monitoring / team sync | ❌ | v2 — cloud is for teams working together |
| Agent marketplace | ❌ | v2 |
| Conflict resolution protocol | ❌ | v1 |
| Structured task file (YAML) | ❌ | v1 |

### 11.2 MVP success criteria

The MVP is successful when the following scenario runs end-to-end without manual tool-level intervention:

1. Developer types a task involving Figma and a local database.
2. Orchestrator assigns junior designer and DB agent.
3. Junior designer creates frames in Figma.
4. DB agent reads schema and publishes it to the context store.
5. Senior designer reviews junior's frames and approves.
6. Developer sees approval card, clicks Approve.
7. Orchestrator synthesises output.
8. Audit log contains a complete record of all tool calls.

---

## 12. Roadmap

### v0.1 — MVP (Fully Local)
- Plugin shell: task input, activity stream, agent cards, local audit log
- Orchestrator: manual mode + auto mode (generates roles from task)
- MCP connection: JSON paste + curated local registry
- Agent onboarding: full UI with persona templates
- Multiple independent MCP servers, each with senior + junior agent team
- Agent spawn-on-demand lifecycle (no idle processes)
- Concurrent mode + slim mode (linear, token-efficient)
- Local SQLite context store, Node.js EventEmitter bus
- Permission middleware, kill switch

### v1.0 — Conflict Resolution + Structured Tasks
- Conflict resolution protocol (cross-domain detection + resolution hierarchy)
- Selective stream pausing (only affected domain pauses)
- Structured task file input (YAML) for deterministic task routing
- Checkpoint and resume for long-running tasks

### v2.0 — Cloud: Teams Working Together
- Cloud workspace for team collaboration
- Shared agent definitions and team registry
- Remote monitoring dashboard (watch agents from outside VS Code)
- Team-wide audit log with filtering and export
- Shared context store sync across team members

### v3.0 — Open Platform
- Public MCP Registry with community submissions
- Agent marketplace (shareable persona templates)
- Plugin API for third-party integrations
- Self-hosted deployment option

---

## 13. Open Questions & Design Decisions

### 13.1 Resolved

| Decision | Choice | Rationale |
|---|---|---|
| Peer communication | Event bus + shared context store | Resilient for long-running tasks, crash recovery |
| Deployment model | Local-first, cloud is additive | Fully works offline; cloud adds teams + remote monitoring |
| Model coupling | Model-agnostic | Any LLM connected to the editor — Ollama, API, IDE-bundled |
| MCP permission enforcement | Middleware in Ujima | MCP servers stay clean; governance is centralised |
| Runtime language | Node.js / TypeScript | MCP SDK is TypeScript-native; event loop matches concurrency model; one language for plugin + orchestrator + agents |
| Context store (local) | SQLite | Zero config, file-based, no Docker required |
| Agent lifecycle | Spawn on demand, exit on complete | No idle processes; context store holds state between invocations |
| Orchestrator modes | Manual + auto | Developer controls team in manual; orchestrator generates roles in auto |
| Execution modes | Concurrent + slim | Concurrent for speed; slim for token efficiency |
| MCP connection UX | JSON paste + registry | Same pattern as Claude desktop; zero friction for existing MCP configs |
| Conflict resolution | v1 (not MVP) | Core loop proven first; conflict resolution added when multi-domain tasks are stable |

### 13.2 All decisions closed

| Decision | Choice | Rationale |
|---|---|---|
| Context store (local) | **SQLite** | JSON files break under concurrent writes — no locking. Redis requires Docker. SQLite is a single file, handles concurrent reads/writes natively, zero config, zero dependencies. When cloud sync is needed in v2, swap the adapter for PostgreSQL. Same query interface. No rewrite. |
| Event bus (MVP) | **Node.js EventEmitter** | In-process, zero dependencies, plenty fast for local single-machine use. The upgrade path to Redis pub/sub is one interface swap when cross-machine events are needed for team mode in v2. Don't add Redis as a dependency just to remove it later. |
| Agent process isolation | **Child processes** | Worker threads share the same memory space — a misbehaving agent can corrupt orchestrator state or other agents. Child processes are fully isolated. A crashed agent cannot take down the orchestrator. IPC overhead is negligible because agent workloads are IO-bound (waiting on LLM and MCP responses), not CPU-bound. This is the same reason Node's own cluster module uses child processes. |
| Governance backend auth | **Clerk** | Custom auth is months of work that has nothing to do with what Ujima is. Auth0 is expensive at scale. Clerk ships in an afternoon, has a generous free tier, handles OAuth, magic links, and org/team management out of the box — which you need for shared workspaces in v2. Migration off Clerk later is straightforward if required. |
| Pricing model | **Open core** | The split is already designed into the architecture. Plugin + orchestrator + local execution = free and open source. Cloud workspace + remote monitoring + team registry = paid. Open source drives adoption and trust with developers. The cloud layer is genuinely additive — not features locked away from free users. This is how Cursor, Raycast, and most successful developer tools work. |
| Agent persona templates | **Curated by Ujima first, community contributions at v2** | Bad community templates at v0.1 make the product feel unreliable. Ship 8–10 high-quality curated templates covering the most common roles: Senior Engineer, Junior Engineer, Senior Designer, Junior Designer, Senior QA, Junior QA, DB Analyst, Tech Writer, Security Reviewer. Open community submissions at v2 when there is enough adoption to moderate and enough good examples to set the quality bar. |
| Webview UI framework | **React + Vite** | Standard pattern across the VS Code ecosystem (Cursor, Continue, Cline). Fast dev loop, rich component ecosystem for activity streams and governance panels. Alternatives like Svelte or vanilla TS don't give enough leverage for the panels Ujima needs. |
| Monorepo tooling | **pnpm workspaces + Turborepo** | Plugin, orchestrator, agent runtime, and shared types all need to share code without npm publish overhead. pnpm handles the workspace graph; Turbo caches build/test across packages so iteration stays fast as the repo grows. |
| LLM abstraction | **Vercel AI SDK + first-class `vscode.lm` adapter** | The AI SDK unifies streaming across Anthropic, OpenAI-compatible, and Ollama behind one interface. The `vscode.lm` adapter is the novel piece — it lets Ujima agents run on whatever chat model the developer already has active in VS Code (Copilot, etc.), removing the "bring your own API key" friction for first-time users. Default provider order is `vscode.lm` → configured API → Ollama. |
| MCP client SDK | **Official `@modelcontextprotocol/sdk`** | One canonical client maintained by the MCP spec authors. Supports all three transports (stdio, SSE, streamable HTTP). Any gaps in multi-client support are handled by Ujima's connection multiplexer rather than forking the SDK. |
| Auto-mode routing (v0.1) | **Template keyword matching, LLM role-gen deferred to v0.2** | Full LLM-generated personas from a task prompt is a research problem — a bad generated team ruins the first impression. Template matching is deterministic, debuggable, and covers the common cases ("design + build", "add tests", "schema migration"). When no preset matches, Ujima asks the user to rephrase or drop to manual mode. The UX surface is identical when LLM role-gen arrives in v0.2 — only the routing engine changes. |
| Approval routing | **Setting `ujima.approvals.mode` — `human_all` default, `senior_auto`, `hybrid`** | Auto-approval by senior agents is the right end-state for trusted teams, but the MVP demo needs to feel in-control — humans should see every approval until they opt in to automation. Making it a setting avoids the false choice between "always manual" and "always auto", and keeps every approval audit-logged regardless of who signed. |
| Context hydration on spawn | **Generous by default — trade tokens for agent quality** | Spawn-on-demand means every run starts cold. Minimal hydration saves tokens but produces shallow, context-free output — the exact failure mode that makes single-agent tools feel dumb. Generous hydration loads persona, approved artifacts, recent domain events, and peer outputs on each spawn, compacted to fit the model's context window. Lean hydration is available per agent for cost-sensitive workflows but is opt-in, not default. |
| Testing stack | **Vitest (unit) + Playwright (e2e via `@vscode/test-electron`)** | Vitest is ESM-native, fast, and matches the dev runtime so snapshot tests don't skew. Playwright's `codegen` materially accelerates webview test authoring. `@vscode/test-electron` is the only supported path for running the extension host in CI. |

---

*Ujima is designed to be an open standard. The protocol, agent definition schema, and MCP registry format are open. The governance backend is the commercial layer.*

*Built with collective work. Run with collective intelligence.*
