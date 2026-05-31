# Agent Membership Controls & Parallel Subagent Spawn

**Goal ID:** ffaebc34-d2ab-4ad8-acd4-4ec054039442
**Status:** Planning — locked
**Branch:** feat/agent-membership-controls
**Created:** 2026-05-30
**Owner:** Carter Jordan

---

## Overview

Two separate features that were discussed together in general channel. Both address fundamental gaps in the agent team model.

- **Feature 2:** Channel-Level Agent Membership Controls — stop agents from being noisy in channels they don't need to be active in
- **Feature 3:** Parallel Subagent Spawn — let agents delegate subtasks in parallel instead of working sequentially

---

## Feature 2: Channel-Level Agent Membership Controls

### Problem
Currently no per-channel agent control. Every agent in a channel sees every message and responds based on persona. A 10-agent org means every agent reacts to everything — noisy, wasteful.

### Controls Per Agent

| Mode | Behavior |
|------|----------|
| **Active** | Normal — responds based on role/persona triggers |
| **Passive / Read-only** | Sees messages, builds context, never auto-replies. Can be @mentioned to respond |
| **Muted** | Invisible to this channel. No messages delivered, no context built |
| **Temporary Disable** | Pause for a set duration (e.g., "1 hour") without removing membership |

### Technical Approach
- Add `membership_state` column to existing agent-channel relationship (no new table)
- Filter pipeline in `page-message` / conversation sync skips muted agents
- UI panel accessible from channel header or settings

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Shared types: add `ChannelMemberMode` enum + `ChannelMemberSettings` schema | ✅ Done | packages/shared/src/org-schemas.ts |
| 2.2 | DB: add `channel_member_modes` table | ✅ Done | packages/context-store/src/db.ts |
| 2.3 | Repo methods: CRUD for channel member modes | ✅ Done | packages/runtime-core/src/repositories/channels.ts |
| 2.4 | Repo reader interface: expose new methods | ✅ Done | packages/orchestrator/src/services/repository-reader.ts |
| 2.5 | Wake suppressed reasons: add `mode-blocked` and `mode-passive` | ✅ Done | packages/shared/src/socket-events.ts |
| 2.6 | Wake enforcement: check mode in `alertChannelReaders`, `alertMentionedMembers`, `alertDirectMessageParticipants` | ✅ Done | packages/orchestrator/src/services/conversation.ts |
| 2.7 | Orchestrator tool: `channel.set_member_mode` | ✅ Done | packages/orchestrator/src/tools/channel.ts |
| 2.8 | Build & test pass | ✅ Done | Shared, runtime-core, orchestrator all compile clean; 74+28+26+123+3 tests pass |
| 2.9 | Member mode UI: Web frontend settings | ✅ Done | Channel Members tab shows mode dropdown for agents |
| 2.10 | API routes: Daemon + Next.js proxy | ✅ Done | GET/PUT /api/orgs/:orgId/channels/:channelId/modes |
| 2.11 | Repository class: wire member modes | ✅ Done | Added to runtime-core Repository class |

---

**Web frontend changes:**
- `channel-members-tab.tsx` — each agent row shows a mode dropdown (Active/Passive/Muted/Temp Disabled) with descriptions. Fetches modes on mount, saves via PUT.
- Daemon Fastify route `channel-member-modes.ts` — GET returns modes, PUT updates a member's mode
- Next.js proxy route at `/api/orgs/[orgId]/channels/[channelId]/modes` — proxies GET/PUT to daemon
- Repository class updated with the missing alias methods

## Feature 3: Parallel Subagent Spawn Tool

### Problem
An agent can only work on one task at a time. For a system selling "AI agents, organized like a team," the inability to parallelize is the biggest gap.

### What's Needed
A `spawn_agent` tool (for agents) and `/spawn` command (for humans) that:
1. Creates a fresh, stateless agent instance
2. Gives it specific instructions
3. Supports **wait** (blocking, get result) or **fire-and-forget** (async, results posted back to thread)
4. Subagent inherits parent's workspace, channel, and tool bindings
5. Results appear in the same thread as a reply from the subagent

### Technical Approach
- `agent-runtime` already has `spawn.ts` and `concurrent.ts` primitives — productize as a user-facing tool
- Subagent lifecycle: spawn → run → post results → die (stateless, no persistence)
- Rate limits: cap concurrent subagents per parent
- Audit log tracks subagent spawns as child runs of parent run

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Tool schemas: define `SpawnAgentInput` / `SpawnAgentResult` | Pending | In agent-skills or tool schemas package |
| 3.2 | Tool implementation: `spawnAgent` function in agent-runtime | Pending | Wraps existing spawn.ts primitives |
| 3.3 | Agent loop integration: register as available tool, handle wait vs fire-and-forget | Pending | In agent-runtime agent loop |
| 3.4 | Session tracking: limit concurrent subagents, orphan cleanup on parent error | Pending | Lifecycle management |
| 3.5 | Result relay: subagent output → parent's thread as reply | Pending | Wire through message service |
| 3.6 | Frontend: status indicator (spawning, running, completed) + `/spawn` slash command | Pending | Chat input + thread UI |

---

## Decisions

Asked 2026-05-31. Re-asked 2026-05-31. Answers locked.

1. **Membership controls** — any channel admin can change an agent's mode.
2. **Passive behavior** — passive agents still read messages for context, but never auto-reply.
3. **Subagent security** — subagents inherit parent access, but production/deploy tools stay blocked by default.
4. **Orphan handling** — kill subagents immediately if the parent errors or is stopped.
5. **Prioritization** — build Feature 2 (Channel-Level Agent Membership Controls) first.

---

## Dependencies Summary

| Feature | Backend Deps | Frontend Deps | Est. Complexity |
|---------|-------------|---------------|-----------------|
| #2 Agent Membership | Medium — extend model, add filter | Medium — membership panel | Medium |
| #3 Subagent Spawn | High — tool wiring, lifecycle, concurrency | Low — mostly backend work | High |
