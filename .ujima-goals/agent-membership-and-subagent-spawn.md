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

### Bugs Fixed (2026-05-31)

| Bug | Severity | Fix | File |
|-----|----------|-----|------|
| `GET /modes` 400 due to missing query param | Medium | Removed `querystring: OrganizationQuerySchema` from route schema — `orgId` already in params | `apps/api/src/transport/routes/channel-member-modes.ts:39` |

**Bug 1 (Passive skipped on @mentions):** Verified code is already correct. `alertMentionedMembers` only skips `muted`/`temp_disable` — `passive` agents pass through and receive mentions. Broadcast path correctly suppresses `passive`.

### Goal Board Redesign (2026-05-31)

- Removed the status `<select>` dropdown from each task card
- Added native HTML5 drag-and-drop: drag cards between Todo / Blocked / In Progress / Done columns
- Drag handle (`GripVertical` icon) appears on hover
- Drop target columns highlight with violet border when dragging over
- Empty columns show "Drop here" prompt during drag
- Loading tasks dim to 50% opacity while status update is in flight

## Feature 3: Parallel Subagent Spawn Tool

### Problem
An agent can only work on one task at a time. For a system selling "AI agents, organized like a team," the inability to parallelize is the biggest gap.

### What's Needed
An `agent.delegate` tool (for agents) that:
1. Sends a one-on-one DM turn to another agent, including itself
2. Wakes the delegated agent exactly once
3. Waits for that agent's turn to finish and returns the final answer
4. Keeps the subagent conversation visible as an agent-only DM thread
5. Ends after returning the final subagent message

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Tool schemas: define `AgentDelegateInput` / `AgentDelegateResult` | ✅ Done | `packages/orchestrator/src/tools/agent-delegate.ts` |
| 3.2 | Tool implementation: `agent.delegate` function | ✅ Done | DM-based wake, waits for delegated turn |
| 3.3 | Agent loop integration: register as available tool | ✅ Done | Registered in `ORCHESTRATOR_TOOLS`, `ALWAYS_AVAILABLE_AGENT_TOOLS`, policy branch |
| 3.4 | Session tracking: limit concurrent subagents, orphan cleanup on parent error | Pending | Lifecycle management |
| 3.5 | Result relay: delegated agent output → caller tool result | ✅ Done | Tool returns reply content and `thread_id` |
| 3.6 | Frontend: status indicator for delegated runs | Pending | Active agent DM UI |

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
