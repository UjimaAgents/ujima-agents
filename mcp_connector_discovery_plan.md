# Connector Catalog + Agent-Driven Discovery — Technical Spec

**Status:** Ready for implementation
**Owner:** Phase 0 — connector substrate
**Branch target:** new branch off `main`
**Reviewers consulted:** Three independent investigations (Anthropic AI lens, Google staff system-design lens, Cuely product/UX lens). All three converged on Option A — agent-driven discovery, no pre-spawn LLM router.

---

## 1. Problem statement

A user attached 60 MCP tools to one agent (24 internal + 36 external). The combined tool schemas exceeded the model's context budget.

The current spawn path at [packages/orchestrator/src/services/spirit-agent-run.ts:751](packages/orchestrator/src/services/spirit-agent-run.ts#L751) inlines every tool's full JSON schema, costing 500–1k tokens per tool. The existing Gemini-specific `dropHeaviestAttachedMcp` recovery at [packages/orchestrator/src/services/spirit-mcp-helpers.ts:38](packages/orchestrator/src/services/spirit-mcp-helpers.ts#L38) papers over the symptom but loses capability silently.

## 2. Goals

1. Support 60+ MCPs attached to one agent without context blowup.
2. Let the agent decide which connector it needs, via the existing approval gate.
3. Make every selection visible and auditable in the run timeline.
4. Zero behavior change for existing orgs at rollout (backwards-compat default).
5. Daniel's in-flight settings form continues without rework.
6. **The change is fundamentally breaking. Keep the legacy spawn path intact and operate the new path beside it (strangler pattern). Legacy is only removed after the new path is proven in production.**
7. Bundle Track A (remote-hosted connector catalog expansion) so the new discovery flow ships with enough connectors to make it visible.

## 3. Non-goals (this PR sequence)

- Pre-spawn LLM router (rejected by all three reviewers — drop entirely).
- OAuth 2.1 + PKCE flows (OAuth-only vendors are listed in the registry but throw a clear error on instantiate).
- Trust state machine (verified/community/quarantined/generated-unverified).
- Public-registry sync, generation-on-miss, sandbox, token broker, validator pipeline.
- Deletion of the legacy spawn path. That's a separate cycle (PR 9, deferred).

## 3.5 Backward-compatibility contract

This is the spine of the design. Every PR in §18 must obey these rules; reviewers reject anything that doesn't.

1. **Legacy code is never edited in place.** The existing `buildMcpToolDefinitions`, `spirit-agent-run.ts` call sites, system prompt builder, and approval card all stay byte-for-byte until the legacy-removal cycle. The new path is added beside them as `*V2` or in new files.
2. **Schema additions are strictly additive.** New columns have `NOT NULL DEFAULT` so legacy code (which doesn't read them) is unaffected. New table columns / schema fields are optional in Zod (`.default(...)`).
3. **Feature flag is the only routing switch.** `mcp.discoverableConnectors.enabled` (default off) gates whether the caller invokes the legacy or V2 path. No shared mutation, no half-states.
4. **Registry additions are additive too.** New `RegistryEntry` fields (`transportKind`, `authMode`, `setupHint`, `lastVerified`) are optional. Existing entries get no behavior change. New entries (Track A) are pure additions to the array.
5. **UI new components only render when their data is present.** `kind: 'connector_request'` ApprovalCardData renders the new variant; rows without `kind` render the existing card unchanged. Timeline rows for `connector_requested` events only appear when the events exist.
6. **Both paths must pass tests at every PR.** Legacy tests stay green throughout. V2 tests are added alongside. CI runs both.
7. **Production runs the legacy path until pilot validates V2.** Even after PR 8 ships, the flag is off everywhere except the internal dogfood org.
8. **Kill switch is unconditional.** Flip the flag off → traffic returns to legacy with zero data migration, zero state cleanup, zero side effects.

---

## 4. User flows

### 4.1 Admin — adding the 10th MCP

```
Admin -> Settings -> MCPs tab -> [Add custom] or [Browse catalog]
      -> Fill form -> Test -> Save
      -> Server appears in list with mode chip: "Discoverable" (default)
      -> Optional: flip toggle to "Always on" for the agents that should always carry it
```

Critical UX rule: **the default mode for a newly-attached MCP is `discoverable`, not `always-on`.** This is what shrinks the spawn palette.

### 4.2 Operator — watching an agent discover a connector

```
Agent spawns
  -> Palette = built-ins + always-on MCPs only
  -> System prompt contains a text catalog of discoverable MCPs
  -> Agent works on task
  -> Agent realises it needs Slack
  -> Agent calls request_connector(slack, "post a summary to #team")
  -> Permission gate fires
  -> Approval card appears in chat (re-uses ApprovalCardData)
  -> Operator clicks one of: [Allow once] [Allow for this run] [Always allow]
  -> Loop resumes; on next turn, Slack tools are in the palette
  -> Agent calls slack__post_message
```

### 4.3 Agent author — debugging a missing capability

```
Run timeline shows:
  -> "Available connectors" system row at run start (collapsed catalog)
  -> tool: list_connectors(query) calls (if any) — agent searched
  -> tool: request_connector(...) calls — what the agent asked for
  -> approval card resolution
  -> subsequent tool calls
Answers "did the agent miss a connector?" by inspecting catalog + agent's reasoning.
```

---

## 5. UX specifications

### 5.1 Settings — MCPs tab — per-attachment row

Touches [apps/web/src/features/settings/organization/components/mcps-tab.tsx](apps/web/src/features/settings/organization/components/mcps-tab.tsx) and the agents subtab at [mcps/agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx).

Add a **mode column** per attachment row:

```
Agent: Phoebe
+-------------+------------------+-------------------------------------+
| MCP         | Scope            | Mode                                |
+-------------+------------------+-------------------------------------+
| Filesystem  | worker           | (o) Always on   ( ) Discoverable    |
| GitHub      | worker           | (o) Always on   ( ) Discoverable    |
| Linear      | worker           | ( ) Always on   (o) Discoverable    |
| Slack       | both             | ( ) Always on   (o) Discoverable    |
| Sentry      | worker           | ( ) Always on   (o) Discoverable    |
+-------------+------------------+-------------------------------------+

Palette estimate: 6.2k / 8k tokens (4 of 12 attached MCPs always-on)
```

**Behavior:**
- Default mode for new attachments = `discoverable`.
- For backwards-compat, the DB migration sets `mode = 'always_on'` for every existing row.
- Live token-budget readout updates as toggles flip. Computed via `estimateToolPaletteTokens` (Section 7.3).

### 5.2 Approval card — `request_connector` resolution

The existing `ApprovalCardData` interface at [apps/web/src/features/workspace/components/chat/approval-card.tsx:9](apps/web/src/features/workspace/components/chat/approval-card.tsx#L9) already supports `allow_once | allow_always | allow_family | reject`. No new resolution type needed.

Add a `kind` discriminator so the card can render connector-request specific copy:

```
+- Phoebe wants to use Slack -------------------------------------+
| [shield] Connector request                                       |
|                                                                  |
| Reason: "Post a summary of the migration PR to #team."           |
|                                                                  |
| Slack provides 7 tools:                                          |
|   - post_message - reply_to_thread - add_reaction - ...          |
|                                                                  |
|  [Allow once]  [Allow for this run]  [Always allow]  [Reject]    |
+------------------------------------------------------------------+
```

**Resolution semantics:**
- `allow_once` — grants Slack for the *next turn only*. Re-prompts on next request.
- `allow_family` (relabeled "Allow for this run") — calls `setSessionOverride` at [packages/permissions/src/index.ts:334](packages/permissions/src/index.ts#L334). Slack is available for the rest of the task session, no more prompts.
- `allow_always` — flips `agent_mcp_attachments.mode = 'always_on'` for this (agent, server). Persists across runs.
- `reject` — denies; agent receives a `denied_by_policy` result and must adapt.

This is Cuely's "approval becomes curation" insight: every `allow_always` teaches the always-on set. By week two, most agents stop asking.

### 5.3 Run timeline — new step types

In [apps/web/src/features/workspace/use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts), three new system rows:

**At run start:**
```
[system] Available connectors (catalog)  [expand]
  Phoebe can request 8 discoverable MCPs:
    - Slack — post messages, read threads. Use for: notifying channels...
    - Sentry — query errors, releases. Use for: incident triage...
    [... 6 more]
```

**Mid-run when agent searches:**
```
[tool] list_connectors(query="messaging")
  -> matched: Slack, Email
```

**Mid-run when agent requests:**
```
[tool] request_connector(serverId="slack", reason="...")
  -> awaiting approval
  -> approved by @oluwaseyi (scope: this_run)
  -> Slack activated; 7 tools available on next turn
```

### 5.4 Token-budget warning

In the attachment matrix (and the per-agent settings page), show:

```
Palette estimate: 11.4k / 8k tokens   [over budget]
  Tip: flip one of [GitHub, Linear, Notion] to Discoverable to fit.
```

The estimate uses `estimateToolPaletteTokens(toolDefs)` over the current always-on set, conservative 1 token ~ 3.5 chars.

---

## 6. Architecture

```
                        +----------------------------------------------+
                        | Spawn                                        |
                        |  buildMcpToolDefinitions(ctx)                |
                        |   |- resolve attachments (existing)          |
                        |   |- partition: alwaysOn vs discoverable     |  <- new
                        |   |- build palette from alwaysOn only        |  <- new
                        |   |- render text catalog for discoverable    |  <- new
                        |   '- register list_connectors,               |  <- new
                        |      request_connector as built-ins          |
                        +----------------------+-----------------------+
                                               |
                       +-----------------------v-----------------------+
                       | Agent loop (ai-sdk-loop.ts)                   |
                       |  streamText with current ToolSet              |
                       +-----------------------+-----------------------+
                                               |
              +--------------------------------+--------------------------------+
              |                                |                                |
   +----------v----------+         +----------v----------+         +-----------v----------+
   | Always-on MCP call  |         | list_connectors     |         | request_connector    |
   |  -> permission gate |         |  -> returns matches |         |  -> permission gate  |
   |  -> mcp.callTool    |         |     from catalog    |         |  -> setSessionOverr. |
   |                     |         |     (no side effect)|         |     OR mode=always_on|
   +---------------------+         +---------------------+         +----------+-----------+
                                                                              |
                                                              +---------------v---------------+
                                                              | Next-turn rebuild             |
                                                              |  LoopExit -> orchestrator     |
                                                              |  rebuilds ToolSet w/ new MCP  |
                                                              |  -> restart streamText        |
                                                              +-------------------------------+
```

The single permission gate at [packages/permissions/src/index.ts](packages/permissions/src/index.ts) remains the only path. `request_connector` is a synthetic tool call that flows through it.

---

## 7. Backend changes

### 7.1 Schema migration

**Table:** `agent_mcp_attachments`
**Add column:** `mode TEXT NOT NULL DEFAULT 'always_on' CHECK (mode IN ('always_on', 'discoverable'))`
**Backfill:** `UPDATE agent_mcp_attachments SET mode = 'always_on'` (no-op since default).
**Why default `always_on`:** existing orgs see zero behavior change at deploy.

Update [packages/shared/src/org-schemas.ts:840-849](packages/shared/src/org-schemas.ts#L840-L849):

```
AgentMcpAttachmentSchema:
  id, organizationId, memberId, mcpServerId,
  scope: McpAttachmentScopeSchema.default('worker'),
+ mode: z.enum(['always_on', 'discoverable']).default('always_on'),
  createdAt, updatedAt
```

Repository methods in [packages/runtime-core/src/repositories/mcp-servers.ts](packages/runtime-core/src/repositories/mcp-servers.ts):
- `saveAgentMcpAttachment` accepts new `mode` field.
- New: `updateAttachmentMode(orgId, memberId, mcpServerId, mode)`.

### 7.2 New module — catalog renderer

**File:** `packages/orchestrator/src/services/connector-catalog.ts`

**Responsibilities:**
- Given `(orgId, memberId, role)`, return:
  - `alwaysOnAttachments: SpiritMcpResolution[]` — flow into the existing palette path.
  - `discoverableServers: CatalogEntry[]` — flow into the text catalog.
  - `catalogText: string` — pre-rendered for system prompt injection.

**`CatalogEntry` shape:**
```
{
  serverId: string;
  name: string;
  category: string;
  shortDescription: string;   // 1-line, verb-led
  useFor: string;              // "Use for: <2-3 concrete tasks>"
  tags: string[];
  toolNamesPreview: string[];  // up to 5 names for the catalog line
}
```

**Catalog text format** (Anthropic insight — precision-critical):
```
- <name> [category] — <description>. Use for: <useFor>. Tools: <names...>. Tags: <tags>.
```

**Cap at 40 entries.** If a server has >40 discoverable attachments, sort by recent-use (from `mcp_tool_cache.fetchedAt`) and truncate. The agent uses `list_connectors(query)` to reach beyond.

**Quality lint** (Anthropic's load-bearing finding): when computing `shortDescription`, if the server's `description` is <20 chars or lacks a verb (heuristic: any of `get|list|read|create|update|delete|post|send|search|query|run|deploy|fetch|find` not present), fall back to `CURATED_REGISTRY` description if the server matches a known entry, else flag for admin review (chip in settings UI).

### 7.3 New module — token estimator

**File:** `packages/orchestrator/src/services/spirit-mcp-helpers.ts` (add to existing)

**New function:** `estimateToolPaletteTokens(toolDefs: ToolSet): number`
- JSON-encode each tool def (name + description + inputSchema).
- Sum `length / 3.5` (conservative chars-per-token for English JSON).

**New constant:** `DEFAULT_PALETTE_TOKEN_BUDGET = 8000`. Configurable per-org on the governance policy row (no new table).

### 7.4 New — `buildMcpToolDefinitionsV2` (legacy stays untouched)

**The legacy `buildMcpToolDefinitions` at [packages/orchestrator/src/services/spirit-agent-run.ts:751](packages/orchestrator/src/services/spirit-agent-run.ts#L751) is NOT edited.** It keeps shipping as the default behavior for every org until the legacy-removal cycle.

A sibling method `buildMcpToolDefinitionsV2` is added next to it on the same class. The caller branches:

```
if (this.flags.mcpDiscoverableConnectors) {
  return this.buildMcpToolDefinitionsV2(ctx);
}
return this.buildMcpToolDefinitions(ctx);  // legacy — unchanged
```

**V2 pseudocode:**
```
1. Call connector-catalog.resolve(ctx) -> { alwaysOn, discoverable, catalogText }
2. For each alwaysOn: run existing listTools + cache-seed loop (unchanged shape).
3. Register list_connectors + request_connector as built-in tools in the toolSet.
4. Attach catalogText to a new field on the returned object so the
   prompt-builder picks it up.
5. Estimate palette tokens. If > budget, drop heaviest alwaysOn (existing
   recovery) and surface a trajectory warning.
```

**V2 return shape:**
```
{
  toolSet,
  servers,               // alwaysOn only
  catalogText,           // NEW
  discoverableServers,   // NEW — for trajectory rendering
}
```

V2 returns a superset of the legacy shape so downstream code that only reads `toolSet` + `servers` continues to work whichever path produced the result.

**System prompt builder** ([packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts)) gets a new optional input `availableConnectors?: string`. When absent (legacy path), the prompt is unchanged. When present (V2), the new section is appended. No conditional logic in the legacy section.

### 7.5 New module — meta-tools

**File:** `packages/orchestrator/src/tools/connector-meta-tools.ts`

**`list_connectors(query?: string)`** — pure, no side effects.
- Reads catalog from `connector-catalog.resolve` (cached for the run).
- Returns matches scored by simple keyword + tag overlap.
- Returns up to 10 matches with the same one-line format.

**`request_connector(serverId: string, reason: string)`** — gated.
- Validates `serverId` exists and is in the discoverable set for this agent.
- Calls `permissions.check` with synthetic `toolName = 'request_connector:<serverId>'`.
- On approval:
  - `allow_once`: write a one-turn override to the loop's runtime state.
  - `allow_family` (this run): `setSessionOverride(orgId, memberId, mcpServerId, allow=true)` for the task session.
  - `allow_always`: `updateAttachmentMode(orgId, memberId, mcpServerId, 'always_on')`.
- Returns `{ activated: true, scope: 'once' | 'session' | 'persistent', tools: [...] }`.
- Triggers `LoopExit` so the orchestrator rebuilds the ToolSet (see Section 8).

**Auto-grant rule (Google's optimization):** if the server's risk class (from `mcp_tool_classifications`) is `read` across all tools, skip the permission gate and auto-grant at session scope. Trajectory still shows the request, marked "auto-granted (read-only)."

### 7.6 Modified — system prompt builder

[packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts)

Add an `availableConnectors` section near the existing tool catalogue:

```
## Available connectors (call request_connector to use)

You have these tools always available: <names of always-on MCPs>.

You can also request access to these connectors when needed:

<catalogText>

To use any of these, call request_connector(serverId, reason). The
operator will approve before you can call the tools.
```

Anthropic's insight: render this **in the prompt, not via a tool call**. Otherwise the model will reflexively call `list_connectors()` every turn.

---

## 8. The mid-loop activation handshake

**The technical landmine.** Google flagged it; the design uses the next-turn rebuild path.

**Constraint:** the AI SDK's `streamText` binds `ToolSet` at call time. You cannot mutate the ToolSet of an in-flight stream.

**Mechanism:**

1. `request_connector` is called by the model.
2. Permission gate evaluates -> approval surfaces in UI.
3. Operator resolves (assume `allow_family`).
4. `setSessionOverride` is written.
5. The tool returns its result to the model AND signals `LoopExit { reason: 'connector_activated', serverId, scope }` to the runner.
6. The runner at [packages/agent-runtime/src/ai-sdk-loop.ts:238](packages/agent-runtime/src/ai-sdk-loop.ts#L238) catches `LoopExit`, finalizes the current `streamText`, and the orchestrator's outer loop reschedules.
7. Next iteration: `buildMcpToolDefinitions` runs again. The new attachment-or-override is now visible. New ToolSet includes Slack.
8. `streamText` restarts with the augmented ToolSet. The model sees its previous `request_connector` result in the message history and proceeds.

**Pattern precedent:** This mirrors how `SchemaTooLargeError` retry already works at [packages/orchestrator/src/services/spirit-mcp-helpers.ts:38](packages/orchestrator/src/services/spirit-mcp-helpers.ts#L38). Reuse the same retry plumbing.

**Critical: do NOT attempt in-flight ToolSet mutation.** That direction leads to a broken stream, lost messages, and untraceable bugs.

---

## 9. Permission / approval flow

### 9.1 Decision matrix

| Server risk | First request_connector call | Subsequent calls in same run | Subsequent runs |
|---|---|---|---|
| read | Auto-grant, no prompt | Cached at session scope | Re-evaluated per spawn |
| write | Prompt operator | Cached if `allow_family` | Re-prompted unless `allow_always` |
| destructive | Prompt operator (mandatory) | Cached if `allow_family` | Re-prompted unless `allow_always` |
| unknown | Prompt operator (defensive) | Cached if `allow_family` | Re-prompted unless `allow_always` |

### 9.2 Approval-storm guard (Google's mitigation)

Per task session, cap `request_connector` invocations:
- Default: 5 calls per run.
- On the 6th, return `denied_by_policy: 'request_connector limit exceeded for this run'`.
- Counter lives in `agentState`, same scope as approval cache.

### 9.3 Trajectory entries

Every `request_connector` invocation produces:
- `connector_requested` event (serverId, reason, riskClass).
- `connector_request_resolved` event (resolution, resolver_member_id).
- `connector_activated` event (when ToolSet rebuilds — confirmation the next turn picked it up).

All three flow through the existing event bus at [packages/event-bus](packages/event-bus).

---

## 10. Frontend changes

### 10.1 Settings — MCPs tab

**Files:**
- [apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx) — add mode column.
- [apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx](apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx) — default new attachment mode to `discoverable`.
- New: `mcps/attachment-mode-toggle.tsx` — segmented control component.
- New: `mcps/palette-budget-meter.tsx` — token-budget readout with traffic-light state.

**State:** extend [use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts) to include `mode` in attachment rows. Add `updateAttachmentMode` mutation.

### 10.2 Approval card

**Files:**
- [apps/web/src/features/workspace/components/chat/approval-card.tsx](apps/web/src/features/workspace/components/chat/approval-card.tsx) — add `kind: 'connector_request'` to `ApprovalCardData`, render new card variant.
- [apps/web/src/features/workspace/approval-card-data.ts](apps/web/src/features/workspace/approval-card-data.ts) — `approvalToCard` maps `request_connector:<serverId>` synthetic tool names to the new card kind, hydrates server name + tool preview.

The four resolution buttons (`allow_once | allow_family | allow_always | reject`) already exist on the card — reuse them. Relabel `allow_family` to "Allow for this run" in the connector-request kind.

### 10.3 Run timeline

**Files:**
- [apps/web/src/features/workspace/use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts) — render `connector_requested`/`connector_activated` events as new timeline row variants.
- [apps/web/src/features/workspace/components/chat/](apps/web/src/features/workspace/components/chat/) — new `connector-event-row.tsx` component.
- At run start, render a `connector-catalog-row.tsx` collapsed view of the catalog text.

### 10.4 VSCode extension

Mirrors the web app changes:
- [apps/vscode-extension](apps/vscode-extension) — settings panel adds mode toggle, approval card variant.

---

## 11. API contracts

### 11.1 New endpoints

**`PATCH /api/orgs/:orgId/agents/:memberId/mcp-attachments/:serverId`**
Body: `{ mode?: 'always_on' | 'discoverable', scope?: ... }`
Used by the settings UI mode toggle.

**`POST /api/runs/:runId/connector-requests/:requestId/resolve`**
Body: `{ resolution: 'allow_once' | 'allow_family' | 'allow_always' | 'reject' }`
Reuses the existing approval-resolution endpoint pattern in [apps/api/src/transport](apps/api/src/transport).

### 11.2 Modified payloads

`GET /api/orgs/:orgId/agents/:memberId/mcp-attachments` returns `mode` on each row.

`GET /api/runs/:runId/timeline` (or equivalent) includes the new event types.

---

## 12. Telemetry + audit

Every meta-tool invocation writes to the existing audit table via [packages/permissions/src/index.ts:115-133](packages/permissions/src/index.ts#L115-L133):

| Event | Fields |
|---|---|
| `connector_listed` | memberId, runId, query, matchCount |
| `connector_requested` | memberId, runId, serverId, reason, riskClass |
| `connector_request_resolved` | requestId, resolution, resolverMemberId, scope |
| `connector_activated` | memberId, runId, serverId, scope (once/session/persistent) |
| `connector_mode_changed` | memberId, serverId, fromMode, toMode, changedBy |

Audit query answers "why did this agent get/not get this tool?" without leaving the DB.

---

## 13. Migration + rollout

### 13.1 Migration

1. Schema migration in [packages/context-store/src/db.ts](packages/context-store/src/db.ts) adds `mode` column with default `always_on`.
2. No backfill needed — default does the work.
3. Repository tests updated to assert the new field.

### 13.2 Rollout

- **Day 0:** Migration ships. All existing attachments are `always_on`. No behavior change.
- **Day 1–7:** Internal dogfood — flip one test org to use `discoverable` for non-essential MCPs. Watch trajectory for request_connector patterns.
- **Week 2:** Enable feature flag `mcp.discoverableConnectors.enabled` per pilot org.
- **Week 4:** Default the attach modal to `discoverable` for new MCPs. Existing rows untouched.
- **Week 6:** Make `discoverable` the default for all new orgs.

### 13.3 Rollback

Feature flag gates everything. If anything regresses, flip the flag off:
- The caller routes back to legacy `buildMcpToolDefinitions` (untouched).
- `mode='discoverable'` rows are simply not read by the legacy path — every attachment behaves as if always-on (pre-PR behavior).
- `list_connectors` / `request_connector` are not registered, so the model can't call them.
- Approval-card variant doesn't render because no `connector_request` events are produced.
- Settings mode-toggle UI hidden.

Zero data migration on rollback. Zero state cleanup. The strangler pattern means the legacy fig is still there to hold the system up.

### 13.4 Legacy removal (separate cycle, NOT this plan)

After the new path has run as default for 2+ weeks across all production orgs with zero new-path regressions, a dedicated cleanup PR (PR 9, deferred) removes:
- Legacy `buildMcpToolDefinitions`.
- Caller-side branching.
- Feature flag.
- Any compat shims in repo / API layer.

Until then the legacy code is sacred. Reviewers reject any PR in this plan that edits it.

---

## 14. Testing strategy

### 14.1 Unit tests

- `connector-catalog.resolve` — partitions correctly, caps at 40, lints descriptions.
- `estimateToolPaletteTokens` — within 20% of `tiktoken` for sample tool defs.
- `request_connector` — auto-grants read-only, prompts for write, denies past cap.
- `updateAttachmentMode` — repository mutation + audit row.

### 14.2 Integration tests

- 30-MCP org with mixed modes -> spawn produces palette <= budget.
- Agent calls `request_connector` -> gate fires -> resolution -> next-turn ToolSet includes new server.
- `allow_always` resolution -> DB row mode flips -> next spawn carries it in palette.
- Approval cap: 6th request_connector in a run is denied with audit entry.

### 14.3 Playwright (existing harness)

- Operator approves connector request in chat UI.
- Settings: toggle attachment mode, see token budget update.

### 14.4 Manual smoke

- 60-tool scenario reproduced. Confirm spawn succeeds, agent discovers what it needs.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Catalog drift — sloppy admin descriptions tank precision | Quality lint at attach-time + fallback to `CURATED_REGISTRY` |
| Approval fatigue | Sticky session grants + auto-grant read-only + per-run cap |
| Catalog itself blows context past ~40 entries | Cap at 40, force `list_connectors(query)` beyond |
| Model reflexively calls `list_connectors` every turn | Render catalog in system prompt; tool is for re-query only |
| Mid-loop rebuild loses message history | Use the existing `SchemaTooLargeError` retry pattern verbatim — proven to preserve history |
| Operator approves wrong connector | Trajectory shows reason string; trivially traceable |
| Feature ships broken on orgs that didn't opt in | Default mode is `always_on`, feature flag gates UI — zero risk |

---

## 16. Out of scope for this PR sequence (sequenced follow-ups)

| Follow-up | Trigger |
|---|---|
| Legacy `buildMcpToolDefinitions` deletion | 2+ weeks of new-path stability in production |
| OAuth 2.1 + PKCE | When first OAuth-only vendor becomes mandatory |
| Pre-spawn LLM router | When org-wide catalog regularly exceeds 80 entries |
| Trust state machine (verified/community/quarantined) | Phase 2 |
| Public registry sync (mcp.so) | Phase 2 |
| Token broker (scoped credentials) | Phase 2 — highest-leverage security move |
| Generation-on-miss + sandbox | Phase 3 |
| Validator pipeline | Phase 3 |

---

## 17. Open decisions

These can be locked during implementation, but flagging them now:

1. **Catalog cap exact number** — 40 (conservative, per Cuely) or 60 (mid-band, per Anthropic ~80 safe upper bound)? Recommend 40 to ship, telemetry to validate.
2. **`allow_once` semantics** — strict next-turn-only, or until model stops using it? Recommend strict next-turn-only; simpler audit story.
3. **Request cap default** — 5 per run. Make configurable per org?
4. **Catalog rendering position in system prompt** — before or after the static tools section? Recommend before, so the model treats catalog as primary surface.
5. **Cache invalidation for catalog text** — per spawn, or cache on `task_session` and invalidate on attachment change?
6. **Read-only auto-grant scope** — session only, or one-time? Recommend session, matches the principle that read is cheap.

---

## 18. Implementation order — split across PRs

[CONTRIBUTING.md:45](CONTRIBUTING.md#L45) sets a 500-line aim and a 2000-line hard cap (insertions only). The work is sequenced into eight PRs, each independently reviewable, revertable, and leaving the system in a working state. A ninth (legacy-removal) is deferred to a separate cycle after production validation.

Every PR obeys the §3.5 backward-compatibility contract: legacy code is never edited, schema is additive only, feature flag is the only routing switch. With the flag off, every PR is a no-op for users.

### PR 1 — Substrate (~250 lines, zero behavior change)

- Schema migration on `agent_mcp_attachments`: add `mode TEXT NOT NULL DEFAULT 'always_on'` ([packages/context-store/src/db.ts](packages/context-store/src/db.ts)).
- `AgentMcpAttachmentSchema` adds `mode: z.enum(['always_on', 'discoverable']).default('always_on')` ([packages/shared/src/org-schemas.ts:840](packages/shared/src/org-schemas.ts#L840)).
- Repository: `saveAgentMcpAttachment` accepts new field; new `updateAttachmentMode` method ([packages/runtime-core/src/repositories/mcp-servers.ts](packages/runtime-core/src/repositories/mcp-servers.ts)).
- `estimateToolPaletteTokens` helper added to [spirit-mcp-helpers.ts](packages/orchestrator/src/services/spirit-mcp-helpers.ts).
- Feature flag scaffold: `mcp.discoverableConnectors.enabled`, default off everywhere.
- Unit tests for the schema parse, repo method, estimator.

Nothing reads the new field yet. Legacy spawn path is untouched.

### PR 2 — Registry expansion (~300 lines, additive only)

Track A remote-hosted catalog + Track B reference stdio servers. Pure data + a few optional field additions to `RegistryEntry`.

- New optional fields on `RegistryEntry` ([packages/mcp-client/src/registry.ts](packages/mcp-client/src/registry.ts)): `transportKind?: 'remote' | 'stdio'`, `authMode?: 'none' | 'pat' | 'oauth'`, `setupHint?: string`, `lastVerified?: string`. Existing entries get no changes.
- New entries — remote PAT/no-auth only: GitHub Copilot MCP, Linear, Sentry, Supabase, Vercel, Context7.
- New entries — stdio reference: Memory, Sequential Thinking, Fetch. Verify exact `@modelcontextprotocol/server-*` package IDs at PR time.
- New entries — OAuth-only (Atlassian, Notion remote): present in catalog but `instantiateFromRegistry` throws a clear "OAuth flow not yet supported" error. Future OAuth PR will fix this without registry changes.
- Unit tests for the new field defaults and the OAuth-throws path.

Benefits even the legacy path immediately: admins can attach these connectors as `always_on` and use them today. Independent of the rest of the plan.

### PR 3 — Catalog renderer (~350 lines, zero behavior change)

- New module: `packages/orchestrator/src/services/connector-catalog.ts`.
  - `resolve(orgId, memberId, role) -> { alwaysOnAttachments, discoverableServers, catalogText }`.
  - Renderer with the verb-led, "Use for", tags format.
  - Cap at 40 entries.
  - Description quality lint with `CURATED_REGISTRY` fallback (uses the entries added in PR 2).
- Unit tests cover partitioning, capping, lint behavior, fallback chain.

Module sits orphaned, ready for PR 5 to wire in. Legacy path is untouched.

### PR 4 — Meta-tools module (~400 lines, behind flag, inert)

- New module: `packages/orchestrator/src/tools/connector-meta-tools.ts`.
  - `list_connectors(query?)` — pure read.
  - `request_connector(serverId, reason)` — permission-gated.
- Permission gate routing: synthetic `toolName = 'request_connector:<serverId>'` handled in [packages/permissions/src/index.ts](packages/permissions/src/index.ts).
- Auto-grant rule for read-only servers.
- Tools are registered ONLY by the V2 spawn path (added in PR 5). Until then the module sits orphaned.

Legacy `buildMcpToolDefinitions` does not import this module. Cannot affect production.

### PR 5 — V2 spawn path + mid-loop rebuild (~450 lines, behind flag)

The technical centerpiece. Carefully isolated against Section 8.

- New method `buildMcpToolDefinitionsV2` on the same class as `buildMcpToolDefinitions`, in a new file (`spirit-agent-run-v2.ts`) or as a sibling method — TBD by reviewer preference, but the legacy method body is byte-for-byte unchanged.
- Caller in [spirit-agent-run.ts](packages/orchestrator/src/services/spirit-agent-run.ts) branches on the flag and routes to V2 or legacy. Single if/else, easily revertable.
- V2 calls `connector-catalog.resolve`, builds palette from `alwaysOn` only, registers meta-tools, attaches `catalogText` to the return.
- System prompt builder gains optional `availableConnectors` input; only V2 passes it ([packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts)).
- `LoopExit { reason: 'connector_activated', serverId, scope }` signal from `request_connector` to the runner.
- Runner handles the exit; orchestrator outer loop reschedules; ToolSet rebuilds on next turn ([packages/agent-runtime/src/ai-sdk-loop.ts:238](packages/agent-runtime/src/ai-sdk-loop.ts#L238)). The runner change is additive — it adds a new exit reason; existing reasons still work identically.
- Integration tests: legacy path stays green; V2 path produces shrunk palette + working request_connector → next-turn activation.

### PR 6 — API + settings UI mode toggle (~400 lines)

- `PATCH /api/orgs/:orgId/agents/:memberId/mcp-attachments/:serverId` ([apps/api/src/transport](apps/api/src/transport)) — accepts `mode` field. Endpoint is callable with the flag off; the field just becomes data the legacy path ignores. Safe.
- Settings UI gains the mode toggle column ([agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx)), gated by the flag — hidden when off.
- New components: `attachment-mode-toggle.tsx`, `palette-budget-meter.tsx`.
- `mcp-attach-modal.tsx` defaults new attachments to `discoverable` only when flag is on; otherwise still defaults to `always_on`.
- [use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts) gains `mode` + `updateAttachmentMode` mutation.
- Playwright: toggle mode, see budget update (flag-on test).

### PR 7 — Approval card variant + timeline rows (~400 lines)

- `ApprovalCardData` gains optional `kind?: 'connector_request'` discriminator ([approval-card.tsx:9](apps/web/src/features/workspace/components/chat/approval-card.tsx#L9)). Existing cards have no `kind` → render the existing variant unchanged.
- New approval-card variant with reason, tool preview, relabeled "Allow for this run" button — rendered only when `kind === 'connector_request'`.
- `approvalToCard` maps `request_connector:<serverId>` synthetic tool names to the new card kind ([approval-card-data.ts](apps/web/src/features/workspace/approval-card-data.ts)). No mapping changes for other tools.
- New timeline row components: `connector-catalog-row.tsx`, `connector-event-row.tsx`. Render only when the corresponding events exist in the timeline.
- [use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts) renders new event types; old events render identically.
- VSCode extension mirrors ([apps/vscode-extension](apps/vscode-extension)).

### PR 8 — Audit/telemetry + dogfood enable (~200 lines)

- Audit events from §12 wired in: `connector_listed`, `connector_requested`, `connector_request_resolved`, `connector_activated`, `connector_mode_changed`.
- Feature flag flipped on for the internal dogfood org. Production orgs still on legacy.
- ADR added to [docs/adr](docs/adr) documenting the design decision and the strangler approach.

### PR 9 — Legacy removal (deferred, separate cycle)

NOT in this plan. Triggered only when:
- New path has been default for 2+ weeks across all production orgs.
- Zero new-path regressions in the audit feed.
- Sign-off from the team.

Then a dedicated PR removes legacy `buildMcpToolDefinitions`, the caller-side branching, the feature flag, and any compat shims. Estimated ~400 lines DELETED, ~50 added.

### Total

~2750 added lines across 8 PRs, averaging ~340 lines each. No single PR exceeds the 500-line aim. Each PR leaves both the legacy path AND the V2 path green and revertable. The system is user-visible only after PR 7 ships AND the flag is flipped per-org — clean kill switch through PR 8 and beyond.

---

## Appendix A — Source materials

- Slack discussion that triggered this work: Oluwaseyi (5/31/2026) on 60-tool overflow + Precious's "list them for the agent" reply.
- Three independent agent investigations (Anthropic AI lens, Google staff system-design lens, Cuely product/UX lens), all converged on Option A.
- Pre-existing planning docs: [mcp_governance_plan.md](mcp_governance_plan.md), [ujima_agents_runtime_plan.md](ujima_agents_runtime_plan.md).

## Appendix B — Files most likely to change

Backend:
- [packages/shared/src/org-schemas.ts](packages/shared/src/org-schemas.ts) — attachment schema gains `mode`.
- [packages/runtime-core/src/repositories/mcp-servers.ts](packages/runtime-core/src/repositories/mcp-servers.ts) — repository methods.
- [packages/context-store/src/db.ts](packages/context-store/src/db.ts) — migration.
- [packages/orchestrator/src/services/connector-catalog.ts](packages/orchestrator/src/services/connector-catalog.ts) — new.
- [packages/orchestrator/src/tools/connector-meta-tools.ts](packages/orchestrator/src/tools/connector-meta-tools.ts) — new.
- [packages/orchestrator/src/services/spirit-agent-run.ts](packages/orchestrator/src/services/spirit-agent-run.ts) — `buildMcpToolDefinitions` modification.
- [packages/orchestrator/src/services/spirit-mcp-helpers.ts](packages/orchestrator/src/services/spirit-mcp-helpers.ts) — token estimator.
- [packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts) — catalog injection.
- [packages/agent-runtime/src/ai-sdk-loop.ts](packages/agent-runtime/src/ai-sdk-loop.ts) — LoopExit signal for rebuild.
- [packages/permissions/src/index.ts](packages/permissions/src/index.ts) — synthetic toolName routing.
- [apps/api/src/transport](apps/api/src/transport) — new endpoints.

Frontend:
- [apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx)
- [apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx](apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx)
- [apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts)
- [apps/web/src/features/workspace/components/chat/approval-card.tsx](apps/web/src/features/workspace/components/chat/approval-card.tsx)
- [apps/web/src/features/workspace/approval-card-data.ts](apps/web/src/features/workspace/approval-card-data.ts)
- [apps/web/src/features/workspace/use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts)
- [apps/vscode-extension](apps/vscode-extension) — mirror surfaces.
