# Ephemeral Delegate Agents

## Goal
Allow `agent.delegate` to create temporary agents on-the-fly when the target doesn't exist. The temp agent is named from the task, spawned with explorer/worker tool sets, and auto-retired after the delegate reply.

## Status: ✅ Implemented

## What Changed

### Schema (tools/agent-delegate.ts)
- Added `name: z.string().min(1).max(60).optional()` to both top-level and `delegates[]` entries
- Updated `normalizeSpawnArgs` to carry `name` through to `delegateAgentTurn`

### Delegate types (tools/types.ts)
- Added `name?: string` to `DelegateHandlers.delegateAgentTurn` input
- Made `to?: string` optional

### Orchestrator (services/index.ts)
Three new helper functions:
- `deriveTempAgentName(name?, message)` — returns `name` if provided, else first 60 chars of `message`
- `isTempAgentRole(roleName)` — checks `@delegate/` prefix
- `retireTempAgent(repo, orgId, agentId)` — sets `retiredAt` on temp agents

`runAgentDelegateTurn` changes:
- `to` is now optional. When absent, skips member lookup.
- `name` field accepted
- When target not found (or `to` absent), creates a new member with:
  - `id`: randomUUID()
  - `name`: from `name` param or derived from `message`
  - `roleName`: `@delegate/worker` or `@delegate/explorer`
  - `kind`: AGENT_KIND, `presence`: online
- Passes `isTempAgent` flag to `waitForAgentDelegateReply`

`waitForAgentDelegateReply` changes:
- Accepts `isTempAgent?: boolean`
- Calls `retireTempAgent()` before every return (completed, failed, no_reply, timed_out)

`stopDelegateImpl` changes:
- Calls `retireTempAgent()` before cancelling the run

## Build: 29/29 tasks pass
## Tests: 5/5 pass (agent-delegate)

## Key Design
- Temp agents are distinguished by `roleName` prefix `@delegate/` (no schema changes to Member)
- Named via `name` param or auto-derived from task message (enables semantic names like "research-auth-flow")
- Auto-retired on any terminal outcome (completed, failure, timeout, stop)
- `getDelegateStatus` is read-only — doesn't trigger retirement
