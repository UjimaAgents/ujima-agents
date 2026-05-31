# Agent Membership Controls & Parallel Subagent Spawn

**Goal ID:** ffaebc34-d2ab-4ad8-acd4-4ec054039442
**Status:** Planning
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
| 2.1 | DB migration: add `membership_state` to agent_channel_members | Pending | Enum: active, passive, muted, temp_disabled |
| 2.2 | API schema: define `AgentMembershipState` enum + membership update payload | Pending | In packages/api-schema |
| 2.3 | Repository method: update membership state, list members with state | Pending | In runtime-core repositories |
| 2.4 | Orchestrator service + API route: PATCH /channels/:id/members/:agentId/mode | Pending | Also GET /channels/:id/members with state |
| 2.5 | Next.js proxy: route handler for the membership endpoints | Pending | apps/web/src/app/api/channels/... |
| 2.6 | Frontend UI: Membership panel in channel header/settings | Pending | Active/Passive/Muted/Temp Disable controls |
| 2.7 | Runtime enforcement: filter muted agents from message delivery + context building | Pending | In the message pipeline |

---

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

## Open Questions

Asked 2026-05-31. Awaiting answers.

1. **Membership controls** — who can change an agent's mode? Any channel admin, or only org admins?
   → *Pending answer*
2. **Passive behavior** — should passive agents still read messages for context, or be truly silent?
   → *Pending answer*
3. **Subagent security** — what tool access should spawned subagents have by default?
   → *Pending answer*
4. **Orphan handling** — what happens to running subagents if parent errors or is stopped?
   → *Pending answer*
5. **Prioritization** — which feature to build first?
   → *Pending answer*

---

## Dependencies Summary

| Feature | Backend Deps | Frontend Deps | Est. Complexity |
|---------|-------------|---------------|-----------------|
| #2 Agent Membership | Medium — extend model, add filter | Medium — membership panel | Medium |
| #3 Subagent Spawn | High — tool wiring, lifecycle, concurrency | Low — mostly backend work | High |
