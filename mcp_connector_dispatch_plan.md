# Connector Dispatch (Hybrid) — Technical Spec

**Status:** Ready for implementation
**Owner:** Phase 0 — connector substrate
**Branch target:** new branch off `main`
**Replaces:** the connector-side architecture of [mcp_connector_discovery_plan.md](mcp_connector_discovery_plan.md). Strangler/backward-compat discipline (§3.5), Track A registry expansion, audit/event spine, and UI scaffolding survive. The mid-loop handshake (§8 of the discovery plan) is **deleted**.
**Reviewers consulted:** Anthropic AI lens, Google staff system-design lens, Cuely product/UX lens (initial converge on Option A); follow-on memo introducing the dispatch counter-design + two refinement passes that produced this document.

---

## 1. Problem statement

A user attached 60 MCP tools to one agent (24 internal + 36 external). The combined tool schemas exceeded the model's context budget.

The original discovery plan solved this by mutating the ToolSet mid-run (request_connector → LoopExit → rebuild → restart). Subsequent review surfaced four blocking problems:

1. **The loophole.** Connector-granular approval + model-authored reason + session-scope grant = consent/capability mismatch. Operator approves "Slack with reason X"; agent gains seven Slack tools for the session.
2. **Mid-loop handshake is harder than the precedent suggests.** `SchemaTooLargeError` retry fires at request construction; `request_connector` fires after a half-emitted turn. Parallel tool calls leave dangling `tool_use` blocks on `LoopExit`. Suspend-for-approval and rebuild-for-activation are two mechanisms with unspecified ordering.
3. **Catalog as prompt-injection surface.** External MCP self-descriptions rendered verbatim into the system prompt — the highest-authority context — is an injection vector.
4. **Concurrency violation.** `allow_always` mutating the attachment row breaks isolation between concurrent runs of the same agent.

This plan adopts a different architecture — **hybrid dispatch** — that closes the loophole structurally, eliminates the mid-loop handshake, and preserves every safety property of the discovery plan.

## 2. Goals

1. Support 60+ MCPs attached to one agent without context blowup. Architecturally unbounded.
2. **Action-level approval.** The operator approves the real tool call (serverId, toolName, args), not a connector + reason string.
3. Make every selection visible and auditable. Audit indexes the unwrapped tuple.
4. Zero behavior change for existing orgs at rollout (backwards-compat default).
5. Daniel's in-flight settings form continues without rework.
6. **The change is fundamentally breaking. Legacy spawn path stays intact alongside the new path (strangler).** Legacy is only removed after the new path is proven in production.
7. Bundle Track A (remote-hosted connector catalog expansion).
8. **Hybrid native + dispatch tiers.** The native tier exists because pure dispatch loses accuracy on Flash/Haiku-class models, which are trained to call typed tools and degrade on generic indirection. The hybrid is not a nicety; it's a measured response to model capability — and the dial between native and dispatch is set by **data**, not by this doc.

## 3. Non-goals

- Pre-spawn LLM router (rejected — drop entirely).
- Pure dispatch (rejected — ergonomic tax on cheap models is real and the originating bug was Gemini-specific).
- OAuth 2.1 + PKCE (OAuth-only vendors are listed in the registry but throw clear errors on instantiate).
- Trust state machine (verified/community/quarantined).
- Public-registry sync, generation-on-miss, sandbox, token broker, validator pipeline.
- Legacy spawn path deletion. Deferred to a later cycle (PR 10).
- Semantic retrieval and `list_connectors` in the initial build (deferred until per-turn catalog cost exceeds budget — see §6.5).

## 3.5 Backward-compatibility contract (verbatim from discovery plan)

This is the spine of the design. Every PR in §18 must obey these rules; reviewers reject anything that doesn't.

1. **Legacy code is never edited in place.** Existing `buildMcpToolDefinitions`, `spirit-agent-run.ts` call sites, system prompt builder, and approval card stay byte-for-byte until the legacy-removal cycle. New path added beside them as `*V2` or in new files.
2. **Schema additions are strictly additive.** New columns are `NOT NULL DEFAULT` so legacy code (which doesn't read them) is unaffected. New Zod fields are optional (`.default(...)`).
3. **Feature flag is the only routing switch.** `mcp.discoverableConnectors.enabled` (default off) gates whether the caller invokes legacy or V2. No shared mutation, no half-states. Tier does NOT route between legacy and V2 — tier is read **inside V2 only**, never by the caller.
4. **Registry additions are additive.** New `RegistryEntry` fields (`transportKind`, `authMode`, `setupHint`, `lastVerified`, `curatedDescription`) are optional. Existing entries unchanged.
5. **UI new components only render when their data is present.** `kind: 'action_request'` ApprovalCardData renders the new variant; rows without `kind` render existing card unchanged.
6. **Both paths must pass tests at every PR.** Legacy tests stay green. V2 tests added alongside.
7. **Production runs the legacy path until pilot validates V2.** Even after PR 8 ships, the flag is off everywhere except the internal dogfood org.
8. **Kill switch is unconditional.** Flip the flag off → traffic returns to legacy with zero data migration, zero state cleanup, zero side effects.

---

## 4. User flows

### 4.1 Admin — adding the 10th MCP

```
Admin -> Settings -> MCPs tab -> [Add custom] or [Browse catalog]
      -> Fill form (including a curated description for non-first-party)
      -> Test -> Save
      -> Server appears in list with tier chip: "Dispatch" (default when flag on)
      -> Optional: flip toggle to "Native" for hot-path agents
```

Critical rule: **default tier for new attachments is `dispatch`.** Promotion to `native` is an explicit, per-agent decision driven by usage data and the bidirectional curation job (§9.4).

### 4.2 Operator — watching an agent invoke a connector

```
Agent spawns
  -> Native-tier MCPs in palette (full typed schemas)
  -> Dispatch-tier MCPs rendered as catalog in the system prompt
  -> Two meta-tools always present: get_connector_tools, invoke_connector_tool
  -> Agent works on task
  -> Agent reads catalog, identifies Slack as needed
  -> (optional) Agent calls get_connector_tools("slack") to see schemas
  -> Agent calls invoke_connector_tool("slack", "post_message",
                                       {channel: "#team", text: "..."})
  -> Permission gate fires on the REAL action (server + tool + args)
  -> Approval card shows: slack.post_message(channel="#team", text="...")
  -> Operator clicks Allow once / Allow for this run / Always allow / Reject
  -> Loop continues IN THE SAME stream (no LoopExit, no rebuild)
  -> Tool executes; result returned to the model
```

### 4.3 Agent author — debugging a missing capability

```
Run timeline shows:
  -> "Available connectors" system row at run start (collapsed)
  -> tool: slack.post_message(channel="#team", ...)  <- unwrapped from audit
  -> approval card + resolution
  -> tool result
Audit query "every slack.post_message in 24h across all agents" works directly
because the audit table indexes (serverId, toolName).
```

---

## 5. UX specifications

### 5.1 Settings — MCPs tab — per-attachment row

Touches [apps/web/src/features/settings/organization/components/mcps-tab.tsx](apps/web/src/features/settings/organization/components/mcps-tab.tsx) and [agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx).

Add a **tier column** per attachment row:

```
Agent: Phoebe
+-------------+------------------+---------------------------------+
| MCP         | Scope            | Tier                            |
+-------------+------------------+---------------------------------+
| Filesystem  | worker           | (o) Native    ( ) Dispatch      |
| GitHub      | worker           | (o) Native    ( ) Dispatch      |
| Linear      | worker           | ( ) Native    (o) Dispatch      |
| Slack       | both             | ( ) Native    (o) Dispatch      |
| Sentry      | worker           | ( ) Native    (o) Dispatch      |
+-------------+------------------+---------------------------------+

Native palette estimate: 6.2k / 8k tokens (2 of 5 attached MCPs native)
Dispatch tier: 3 MCPs, structural catalog cost ~180 tokens.
```

**Behavior:**
- Default tier for new attachments = `dispatch` when flag is on; `native` when off (backwards-compat).
- Migration backfills every existing row to `tier='native'` so legacy behavior is exact.
- Tier toggle has a "Show usage" sublink → opens a small panel from the curation job (§9.4) suggesting demote/promote candidates.

### 5.2 Approval card — action-level resolution

The existing `ApprovalCardData` at [approval-card.tsx:9](apps/web/src/features/workspace/components/chat/approval-card.tsx#L9) gains a `kind: 'action_request'` discriminator. The new variant shows the **action**, not the connector:

```
+- Phoebe wants to run slack.post_message --------------------------+
| [shield] Connector action                                          |
|                                                                    |
| Server:  Slack                                                     |
| Tool:    post_message                                              |
|                                                                    |
| Arguments:                                                         |
|   channel: "#team"                                                 |
|   text:    "Migration PR opened: github.com/org/repo/pull/123"     |
|                                                                    |
|  [Allow once]  [Allow for this run]  [Always allow]  [Reject]      |
+--------------------------------------------------------------------+
```

**Resolution semantics:**
- `allow_once` — runs this exact `(toolName, args)` invocation; re-prompts on next call.
- `allow_family` (rendered "Allow for this run") — caches grant in permission store for `(agent, server, toolName)` for this task session. Same args-shape calls skip the gate.
- `allow_always` — persists `(agent, server, toolName)` grant in the permission store. Does **not** mutate the attachment row's tier (orthogonality invariant — §9.3).
- `reject` — denies; agent receives `denied_by_policy` and must adapt.

The four buttons already exist on `ApprovalCard` ([approval-card.tsx:53](apps/web/src/features/workspace/components/chat/approval-card.tsx#L53)). Just relabel `allow_family` to "Allow for this run" in this card kind.

### 5.3 Run timeline — unwrapped action rows

In [use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts), new system rows:

**At run start:**
```
[system] Available connectors (catalog) [expand]
  Native tier (typed, always available): Filesystem, GitHub
  Dispatch tier (call get_connector_tools to see schemas):
    - Linear     [project mgmt]    tools: issues_search, issue_create...
    - Slack      [messaging]       tools: post_message, reply_to_thread...
    - Sentry     [observability]   tools: events_search, releases_list...
```

**Mid-run when agent invokes a dispatch tool:**
```
[tool] slack.post_message
       channel: "#team"
       text:    "Migration PR opened: ..."
       -> awaiting approval
       -> approved by @oluwaseyi (scope: this_run)
       -> ok (event_id: 0xABC)
```

The row reads as `slack.post_message`, not `invoke_connector_tool`. The unwrap happens at the audit-write layer (§12), not just the renderer — so the timeline is grep-able by real tool name.

### 5.4 Token-budget warning (native tier only)

```
Native palette estimate: 11.4k / 8k tokens  [over budget]
  Tip: demote one of [GitHub, Linear, Notion] to Dispatch.
  Dispatch tier carries zero per-tool palette cost.
```

Dispatch tier doesn't add to the per-turn budget (catalog is rendered once in the system prompt; not re-listed per turn). The meter only watches the native tier.

---

## 6. Architecture (redrawn around dispatch)

### 6.1 The core move

`streamText` binds `ToolSet` at call time. The discovery plan fought this by exiting the loop, rebuilding, and restarting. **This plan sidesteps it.** The palette is constant for the whole run:

```
built-ins + native-tier MCP tools (full typed schemas)
          + two meta-tools: get_connector_tools, invoke_connector_tool
```

Connectors in the dispatch tier are not tools in the palette — they are **rows in a catalog** rendered in the system prompt. To use any dispatch-tier connector, the model calls `invoke_connector_tool(serverId, toolName, args)`. The set of tool *definitions* never changes during a run.

### 6.2 Spawn-time partition (inside V2 only)

```
buildMcpToolDefinitionsV2(ctx):
  resolve attachments
  for each attachment:
    if attachment.tier == 'native':
      list tools, add full typed schemas to palette  (existing path)
    if attachment.tier == 'dispatch':
      add CatalogEntry to catalog (structural facts only if un-curated)
  register get_connector_tools + invoke_connector_tool as built-ins
  return { toolSet, nativeServers, dispatchCatalogText }
```

Legacy `buildMcpToolDefinitions` is tier-blind — when called (flag off), it loads every attachment as it does today. The `tier='native'` backfill on existing rows preserves legacy behavior exactly.

### 6.3 Agent loop — unchanged

```
streamText with FIXED ToolSet
  -> model emits tool calls (native and/or dispatch)
  -> each tool runs in-stream
  -> result returned in the SAME stream
  -> no LoopExit, no rebuild, no restart
```

[packages/agent-runtime/src/ai-sdk-loop.ts](packages/agent-runtime/src/ai-sdk-loop.ts) is **not modified**. This is the headline.

### 6.4 The two meta-tools

`get_connector_tools(serverId)` — pure read. Returns the connector's tool list with full input schemas, in-context, on demand. No side effects, no gate.

`invoke_connector_tool(serverId, toolName, args)` — gated. Inside it:
1. Structural checks: server attached, in dispatch tier.
2. Server-side schema validation against the cached MCP tool schema. On miss, return the schema in the error so the model corrects on the next turn.
3. **Action-level permission gate** — `permissions.check(serverId, toolName, args, riskClass)`. Real tool, real args. No synthetic `request_connector:<id>` name.
4. On approval (or auto-grant), call the MCP and return the result in the same stream.
5. The existing approval-pause path at [ai-sdk-loop.ts:215](packages/agent-runtime/src/ai-sdk-loop.ts#L215) suspends the tool execution if a human is in the loop — that's an *existing* mechanism for built-in tools too. No new suspension machinery.

### 6.5 list_connectors — deferred

If you render the full catalog at spawn (fine for tens of connectors), the model already has the catalog text in its context. Running keyword search over text that's already in context is redundant — `list_connectors` adds nothing.

Phasing:
- **Phase 1 (this plan):** render the full catalog at spawn + `get_connector_tools`. No `list_connectors`.
- **Phase 2 (deferred trigger):** rendered catalog × every turn exceeds the per-turn token tolerance. Then introduce `list_connectors` with keyword retrieval over the catalog, and render a subset at spawn.
- **Phase 3 (deferred further):** semantic retrieval with embedding index.

The phase-2 trigger is long-run-sensitive, not count-sensitive. PR 4 ships without `list_connectors`.

---

## 7. Backend changes

### 7.1 Schema migration

**Table:** `agent_mcp_attachments`
**Add column:** `tier TEXT NOT NULL DEFAULT 'native' CHECK (tier IN ('native', 'dispatch'))`.
**Backfill:** default does the work. Every existing row is `'native'`. Legacy spawn path is tier-blind, so this is precisely backwards-compatible.

Update [packages/shared/src/org-schemas.ts:840](packages/shared/src/org-schemas.ts#L840):

```
AgentMcpAttachmentSchema:
  id, organizationId, memberId, mcpServerId,
  scope: McpAttachmentScopeSchema.default('worker'),
+ tier: z.enum(['native', 'dispatch']).default('native'),
  createdAt, updatedAt
```

Repository methods in [packages/runtime-core/src/repositories/mcp-servers.ts](packages/runtime-core/src/repositories/mcp-servers.ts):
- `saveAgentMcpAttachment` accepts new `tier`.
- New: `updateAttachmentTier(orgId, memberId, mcpServerId, tier, reason)`.

### 7.2 New module — catalog renderer

**File:** `packages/orchestrator/src/services/connector-catalog.ts`

**Responsibilities:**
- Given `(orgId, memberId, role)`, return:
  - `nativeAttachments: SpiritMcpResolution[]` — existing palette path.
  - `dispatchCatalog: CatalogEntry[]` — rendered into the system prompt.
  - `catalogText: string` — the rendered block.

**`CatalogEntry` shape:**
```
{
  serverId: string;
  name: string;
  category: string;
  curatedDescription: string | null;   // null -> structural-facts-only
  toolNamesPreview: string[];
  toolCount: number;
}
```

**Render rules:**

If the MCP matches an entry in `CURATED_REGISTRY` OR has an explicit admin-curated description: render as `<name> [category] — <curated description>. Use for: <…>. Tools: <names…>.`

Otherwise (un-curated external): render **structural facts only** — `<name> [category] — <toolCount> tools: <names…>`. **No prose from the server's self-description ever reaches the system prompt.** This closes the prompt-injection surface by construction; admin diligence is not the safety mechanism.

No cap on number of dispatch entries in Phase 1 — dispatch is architecturally unbounded. Soft warning in admin UI when rendered catalog exceeds 5k tokens (Phase-2 trigger).

### 7.3 New module — per-model token estimator

**File:** `packages/orchestrator/src/services/spirit-mcp-helpers.ts` (extend existing).

**New function:** `estimateToolPaletteTokens(toolDefs: ToolSet, model: ModelId): number`
- For Anthropic / OpenAI models: use the conservative `chars / 3.5` approximation (calibrated against tiktoken).
- For Gemini models: use a Gemini-specific divisor (the originating bug was Gemini-specific; chars/3.5 underestimates by ~25% on its tokenizer).
- For unknown models: max-of approach to stay conservative.

**Constant:** `DEFAULT_PALETTE_TOKEN_BUDGET = 8000`. Configurable per-org on the governance policy row.

### 7.4 New — `buildMcpToolDefinitionsV2` (legacy stays untouched)

Legacy `buildMcpToolDefinitions` at [packages/orchestrator/src/services/spirit-agent-run.ts:751](packages/orchestrator/src/services/spirit-agent-run.ts#L751) is **NOT edited**. Tier-blind by design — when called (flag off), loads every attachment as today.

A sibling method `buildMcpToolDefinitionsV2` is added next to it. The caller branches on the flag:

```
if (this.flags.mcpDiscoverableConnectors) {
  return this.buildMcpToolDefinitionsV2(ctx);
}
return this.buildMcpToolDefinitions(ctx);  // legacy — unchanged
```

**V2 pseudocode:**
```
1. Call connector-catalog.resolve(ctx) -> { native, dispatchCatalog, catalogText }
2. For each native: run existing listTools + cache-seed loop (unchanged shape).
3. Register get_connector_tools + invoke_connector_tool as built-ins.
4. Attach catalogText to a new field on the returned object for the prompt builder.
5. Estimate native-palette tokens. If over budget, **spill the lowest-priority
   native servers to dispatch FOR THIS SPAWN ONLY** — a computed in-memory
   override, never written to the attachment row. Capability is fully preserved
   (spilled servers stay reachable through `invoke_connector_tool` with zero
   per-tool palette cost); only palette tokens are spent. The §3.5 isolation
   rule applies to attachment-row *mutation*, not to per-spawn computed
   derivations — concurrent runs of the same agent each compute their own
   spill independently, no cross-run side effects.

   This replaces the discovery plan's `dropHeaviestAttachedMcp` amputation
   that was correctly killed in §1: **dispatch is the lossless overflow
   valve**, not capability loss. On hard-schema-limit models (the originating
   Gemini bug) the spill is what keeps the spawn alive; on softer-limit
   models it's still a strict context-budget win.

   Spill priority (lowest first):
     a. Channel-attached native before per-agent native (per-agent is
        deliberate, channel is bulk).
     b. Within each, oldest `last_invoked_at` first (cold first). When
        `last_invoked_at` is NULL (no history), fall back to attachment
        `createdAt` in the same direction so cold-start spawns still order
        deterministically.
     c. Spill servers with the LOWEST dispatch-mode validation-error rate
        first; protect HIGH-error servers in the typed palette. This
        aligns with §9.4's promote signal: high error rate is the
        model-fumbling-indirection signal, and those are exactly the
        tools that want to STAY native. Spilling a low-error tool to
        dispatch costs no accuracy (the model handles it cleanly through
        indirection); spilling a high-error tool defeats the hybrid on
        the cheap models the hybrid exists to protect.

   `last_invoked_at` provenance: denormalized column on the attachment
   row, updated by the §12 audit-write layer on every successful
   `invoke_connector_tool` call (and on every native typed-tool call
   while still in the typed palette). Single source of truth, indexed
   for fast spawn-time read.

   Dispatch-mode validation-error rate provenance: a server that's been
   native since attachment has never executed through dispatch, so the
   (c) rank has no value to read from runtime history. Seed it from the
   PR 4.5 measurement table keyed by `(model, serverId, toolName)`; on a
   miss (new tool, unmeasured model), fall back to that table's
   per-model median. The seed is the same source PR 5 uses for its
   native-promotion list, so the spill and the seed never disagree by
   construction.

   Trajectory entry on every spill: `palette_spill_to_dispatch` event with
   the list and the budget delta. Operator sees the system breathing and
   can tune tier choices on next settings load — but the spawn doesn't
   wait for them.
```

**V2 return shape:**
```
{
  toolSet,
  servers,                 // native tier only
  catalogText,             // NEW — rendered dispatch catalog
  dispatchCatalog,         // NEW — for trajectory rendering
}
```

System prompt builder ([packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts)) gets a new optional input `availableConnectors?: string`. Absent (legacy) → prompt unchanged. Present (V2) → catalog block appended.

### 7.5 New module — meta-tools

**File:** `packages/orchestrator/src/tools/connector-meta-tools.ts`

**`get_connector_tools(serverId: string)`** — pure read.
- Validates `serverId` is attached and in dispatch tier.
- Returns cached tool list + full input schemas from `mcp_tool_cache`.
- No permission gate, no side effects.

**`invoke_connector_tool(serverId: string, toolName: string, args: Record<string, unknown>)`** — gated.
- Validates attachment + tier.
- Validates `args` against the cached tool's input schema. On miss, return the schema in the error result so the model can correct on the next turn.
- Computes `riskClass` per-call from `classify(serverId, toolName, args)` — arg-aware. A `fetch(url)` with an external URL is classified as egress even when the tool's static class is `read`.
- Calls `permissions.check({ serverId, toolName, args, riskClass })` — real values.
- On approval (or auto-grant), calls the MCP and returns the result **in the same stream**.

No mid-loop rebuild. No LoopExit signal. No restart.

### 7.6 Auto-grant rule (revised)

The discovery plan's "auto-grant all read-only servers" rule is dangerous: `read` in HTTP-verb terms is exfiltration in semantic terms.

New rule: auto-grant requires **all three** to hold:
1. Static `tool.riskClass == 'read'` per `mcp_tool_classifications`.
2. No egress signals in args (no external URL, no email/messaging target, no file write path).
3. Session has not already revoked this server.

When all three hold: grant at session scope, no prompt. Trajectory still records the call, marked `auto-granted (read, no egress signal)`. Operator can revoke per-server via a chat-side action.

---

## 8. DELETED

The discovery plan's §8 ("the technical landmine") covered the mid-loop handshake: LoopExit signal, finalize streamText, rebuild ToolSet, restart streamText, history coherence.

**The dispatch design eliminates this entire section.** The palette is constant for the run; there is nothing to rebuild. The `SchemaTooLargeError` retry precedent — which never actually matched the request_connector case — is no longer needed for this at all. `ai-sdk-loop.ts` is untouched.

---

## 9. Permission / approval flow

### 9.1 Decision matrix (per-action, not per-connector)

| Tool risk + args | First call in session | Subsequent same-(server, tool) calls | Persistence |
|---|---|---|---|
| `read` AND no egress signals | Auto-grant, no prompt | Cached at session scope | Re-evaluated per run |
| `read` AND egress signals | Prompt operator | Cached if `allow_family` | Re-prompted unless `allow_always` |
| `write` | Prompt operator | Cached if `allow_family` | Re-prompted unless `allow_always` |
| `destructive` | Prompt operator (mandatory) | Cached if `allow_family` | Re-prompted unless `allow_always` |
| `unknown` | Prompt operator (defensive) | Cached if `allow_family` | Re-prompted unless `allow_always` |

### 9.2 Two caps on two axes (NOT one cap on calls)

The discovery plan capped `request_connector` at 5/run because discovery events were rare. `invoke_connector_tool` is the work primitive — every dispatch-tier action flows through it. A single 50-invocation cap throttles legitimate work (a data agent doing 80 cached Slack posts dies at 50 for zero safety benefit).

Split the cap onto two actual axes:

**Approval-storm limiter** — counts *novel operator prompts per run*. Default 15–20. Cache hits and auto-grants uncapped. Triggers a "the agent is fishing — operator review" UI banner at threshold − 5.

**Runaway-loop limiter** — counts *total meta-tool calls per run* — `invoke_connector_tool` + `search_catalog` + `get_connector_tools` + `request_attachment`, summed. Default 300. Catches infinite loops on both work and read tools; doesn't throttle legitimate fan-out. Single counter, single rule. Without the read tools in the sum, a model looping on `search_catalog` every turn would bloat context without ever tripping a cap.

Both counters live on the run state and are surfaced in the timeline.

### 9.3 Orthogonality invariant (write this down)

**Tier (palette membership) and permission-store grant (approval state) are orthogonal. `allow_always` persists a grant; it does NOT promote a tier.**

In code: the `allow_always` handler writes to the grant cache only — never to `agent_mcp_attachments.tier`. Tier mutation is a separate operator decision with its own UI affordance (the settings tier toggle) or the curation job (§9.4).

This prevents the concurrency violation from the discovery plan. Two concurrent runs of the same agent each get their own grant cache scope; neither mutates shared row state mid-run.

### 9.4 Bidirectional curation job

A scheduled job (default daily) reads audit data and produces tier-change suggestions surfaced in the settings UI.

**Demote (native → dispatch):**
- Native-tier tool with zero calls in N runs (default 30).
- Surfaces as a panel suggestion, not auto-applied — operator confirms.

**Promote (dispatch → native):**
- Dispatch-tier tool where `(volume_per_run > V) AND (validation_error_rate > E)`.
- Error rate is the model-fumbling-indirection signal. Volume alone over-promotes hot read tools that don't actually need typing.
- Also surfaces as suggestion, not auto-applied.

The job persists its findings in a new `tier_curation_suggestions` table. The admin UI panel reads from it.

### 9.5 Trajectory entries

Every meta-tool invocation produces:
- `connector_tools_listed` (when `get_connector_tools` runs).
- `connector_invocation_requested` — serverId, toolName, args, riskClass.
- `connector_invocation_resolved` — resolution, resolver, scope.
- `connector_invocation_completed` — success/error.
- `connector_tier_changed` — admin or curation-job changes.

All flow through [packages/event-bus](packages/event-bus).

---

## 10. Frontend changes

### 10.1 Settings — MCPs tab

**Files:**
- [agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx) — add tier column.
- [mcp-attach-modal.tsx](apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx) — default new attachments to `dispatch` when flag is on. Add curated-description field; lint at attach time (warn if non-first-party server is left un-curated).
- New: `mcps/attachment-tier-toggle.tsx` — segmented control.
- New: `mcps/palette-budget-meter.tsx` — native-tier budget readout.
- New: `mcps/curation-suggestions-panel.tsx` — reads `tier_curation_suggestions`, surfaces demote/promote.

**State:** [use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts) gains `tier` + `updateAttachmentTier` mutation.

### 10.2 Approval card

**Files:**
- [approval-card.tsx:9](apps/web/src/features/workspace/components/chat/approval-card.tsx#L9) — `kind: 'action_request'` discriminator; new variant rendering server name, tool name, args preview.
- [approval-card-data.ts](apps/web/src/features/workspace/approval-card-data.ts) — `approvalToCard` recognizes the unwrapped tuple (which now lives in audit) and produces the action_request shape.

The four resolution buttons already exist. Just relabel `allow_family` to "Allow for this run" in this card kind.

### 10.3 Run timeline

**Files:**
- [use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts) — renders unwrapped action rows from audit data.
- New components: `connector-catalog-row.tsx`, `connector-action-row.tsx`.
- Display: `slack.post_message(...)`, NOT `invoke_connector_tool(serverId=slack, toolName=post_message)`.

### 10.4 VSCode extension

Mirrors the web app changes: [apps/vscode-extension](apps/vscode-extension).

---

## 11. API contracts

### 11.1 New endpoints

**`PATCH /api/orgs/:orgId/agents/:memberId/mcp-attachments/:serverId`**
Body: `{ tier?: 'native' | 'dispatch', scope?: ... }`
Used by settings UI tier toggle and the curation-suggestions panel.

**`POST /api/runs/:runId/connector-actions/:requestId/resolve`**
Body: `{ resolution: 'allow_once' | 'allow_family' | 'allow_always' | 'reject' }`
Reuses the existing approval-resolution endpoint pattern.

**`GET /api/orgs/:orgId/tier-curation-suggestions`**
Returns the curation job's pending demote/promote suggestions for admin review.

### 11.2 Modified payloads

`GET /api/orgs/:orgId/agents/:memberId/mcp-attachments` returns `tier`.

`GET /api/runs/:runId/timeline` includes the new event types with the **unwrapped tuple** in the payload (not an `invoke_connector_tool` blob).

---

## 12. Telemetry + audit — unwrap at WRITE time

This is the substantive piece, not the renderer.

The audit table stores the unwrapped tuple. The persisted event is `(server_id, tool_name, args_json)` — indexed by `(server_id, tool_name)` and by `(tool_name)` so the operator query "every slack.post_message in 24h across all agents" runs against indexed columns.

If the stored event were `invoke_connector_tool` with `args` as an opaque blob, the same query would require a full-table scan with JSON parsing. Incidents get worked from these queries; the grep-ability you're paying for has to exist where it's used.

### 12.1 Audit table changes

Add columns to the audit table at [packages/context-store/src/db.ts](packages/context-store/src/db.ts):

```
ALTER TABLE audit_log ADD COLUMN server_id TEXT;
ALTER TABLE audit_log ADD COLUMN tool_name TEXT;
ALTER TABLE audit_log ADD COLUMN args_json TEXT;
CREATE INDEX audit_log_tool_idx ON audit_log (tool_name);
CREATE INDEX audit_log_server_tool_idx ON audit_log (server_id, tool_name);
```

Existing rows have these as NULL — no migration cost.

### 12.2 Audit events

| Event | Fields written to audit_log |
|---|---|
| `connector_tools_listed` | memberId, runId, serverId, fetchedToolCount |
| `connector_invocation_requested` | memberId, runId, serverId, toolName, args_json, riskClass |
| `connector_invocation_resolved` | requestId, resolution, resolverMemberId, scope, serverId, toolName |
| `connector_invocation_completed` | requestId, serverId, toolName, success, errorMessage |
| `connector_tier_changed` | memberId, serverId, fromTier, toTier, changedBy, reason |

`args_json` may be redacted per a per-org policy (sensitive arg shapes). Redaction policy is org-configurable; default redacts password / token / secret keys.

---

## 13. Migration + rollout

### 13.1 Migration

1. Schema migration adds `tier` column with default `native`.
2. Audit table gets `server_id`, `tool_name`, `args_json` + indexes.
3. No backfill needed for `tier` — default does the work.
4. Repository tests updated to assert new fields.

### 13.2 Rollout

- **Day 0:** Migration ships. All attachments are `native`. No behavior change.
- **Day 1–7:** Measurement PR runs in shadow on internal dogfood org. Diagnostic per (model × tool).
- **Week 2:** Flag flipped on for the dogfood org. New attachments default to `dispatch`. Existing rows untouched at `native`.
- **Week 4:** Pilot orgs (3–5) opt in. Bidirectional curation job runs.
- **Week 6+:** Per-org rollout, telemetry-gated.

### 13.3 Rollback

Feature flag gates everything.

- Flip flag off → caller routes back to legacy `buildMcpToolDefinitions` (untouched).
- `tier='dispatch'` rows simply aren't read by the legacy path — every attachment behaves as if `native` (pre-PR behavior).
- `get_connector_tools` / `invoke_connector_tool` are not registered.
- Approval-card variant doesn't render (no `action_request` events produced).
- Settings tier-toggle UI hidden behind the flag.

Zero data migration on rollback. Zero state cleanup.

### 13.4 Legacy removal (separate cycle, NOT this plan)

After the new path has run as default for 2+ weeks across all production orgs with zero new-path regressions, a dedicated cleanup PR (PR 12, deferred) removes:
- Legacy `buildMcpToolDefinitions`.
- Caller-side branching.
- Feature flag.
- Any compat shims.

Until then the legacy code is sacred. Reviewers reject any PR in this plan that edits it.

---

## 14. Testing strategy

### 14.1 Unit tests

- `connector-catalog.resolve` — partitions by tier; structural-facts-only fallback fires for un-curated; curated descriptions render verbatim.
- `estimateToolPaletteTokens` — within tolerance per model.
- `invoke_connector_tool` — validates schema; routes through gate; auto-grants honor egress signals; rejects unknown tools with schema in error.
- `updateAttachmentTier` — repo mutation + audit row.
- Curation job — demote/promote candidates produced from synthetic audit data.

### 14.2 Integration tests

- Legacy path: tier-blind, every attachment in palette, behaves as today.
- V2 path: native + dispatch partition; meta-tools registered; catalog in prompt.
- `invoke_connector_tool` round-trip: validation → gate → MCP call → result in same stream. No LoopExit.
- 60-tool scenario reproduced. Native = 5, Dispatch = 55. Spawn succeeds; native palette stays under budget.
- Approval-storm cap fires at 20 novel prompts; cache hits don't count.
- Runaway-loop cap fires at 300 total calls.

### 14.3 Playwright

- Operator approves an action_request card in chat UI.
- Settings: tier toggle, palette budget update.
- Curation suggestions panel: demote a cold native tool.

### 14.4 Measurement PR — diagnostic per (model × tool)

The empirical gate before V2 wires.

**Test matrix:** 3 models × 10 representative tasks × 2 configs (native palette vs dispatch).
- Models: Gemini Flash, Claude Haiku 4.5, Claude Sonnet 4.6.
- Tasks: span discovery (use a connector I haven't seen), execution (call a known tool), and recovery (handle validation error).

**Metrics per (model, tool):**
- Success rate.
- Turns-to-success (a tool that always succeeds but costs 2 extra turns is a promotion candidate).
- Validation-error rate (the model-fumbling-indirection signal).
- `get_connector_tools` round-trip rate.

**Output:** JSON report + initial default native-promotion list. The list is committed in PR 5 as the V2 spawn's seed configuration.

**Character-of-the-system gate.** A "cheap models need lots of native to stay accurate" result is not just a tuning parameter — it changes the system's character. If most production agents need large native palettes, the §7.4 step 5 spill stops being an edge-case safety net and becomes the hot path. A frequently-spilling palette varies its cold-set spawn-to-spawn, which softens the spawn determinism that dispatch otherwise buys (the same channel + agent combo could yield different palettes across spawns depending on which servers were below the spill threshold that day). Before PR 5 wires, the measurement output is reviewed against a "spill-as-hot-path?" question; a yes answer triggers a small design addendum (per-agent native budget overrides, deterministic spill seeds keyed on `(memberId, day)`, or both) rather than silently shipping a system whose runs are less reproducible than the doc claims.

### 14.5 Manual smoke

- 60-tool scenario reproduced.
- Catalog injection attempt: attach a custom MCP with a malicious self-description; verify structural-facts fallback renders only name + tool names.
- Run isolation: two concurrent runs of one agent, one resolves `allow_always`; verify the other run's palette is unchanged mid-flight.

---

## 15. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Loophole — model-authored reason + connector-scope grant | **Closed structurally.** Action-level gate sees real `(server, tool, args)`. |
| Catalog as prompt-injection surface | Un-curated external → structural-facts only. Verbatim server descriptions never reach the prompt. |
| Cheap-model accuracy regression on indirection | Measurement PR + native-promotion list. Hybrid by design. |
| Concurrency violation from `allow_always` | Grant cache, not tier mutation. Orthogonality invariant in §9.3. |
| Curation ratchet drift back to overflow | Bidirectional curation job (demote cold + promote error-prone). |
| Estimator wrong for Gemini | Per-model tokenizer in §7.3. |
| Catalog grows past per-turn budget | Phase-2 trigger introduces `list_connectors` (deferred until measured). |
| Native palette balloons from channel membership | Closed by §17.5.3 merge rule (channel-vs-channel conflicts resolve to **dispatch**, never native) + §7.4 step 5 spawn-time computed spill. Dispatch is the lossless overflow valve. |
| Spawn over budget on a hard-schema-limit model | Spawn-time computed spill to dispatch (§7.4 step 5) — capability preserved, palette tokens spent. No `dropHeaviestAttachedMcp` amputation. |
| Read meta-tools loop without tripping the limiter | §9.2 limiter counts all meta-tools (read + write) toward the 300-call cap. Single counter. |
| Operator approves wrong action | Card shows args inline; audit indexes `(server, tool)`; trivially traceable. |
| Approval fatigue | Split caps; session cache; sticky grants per real (server, tool). |
| Auto-grant on read is exfiltration | Egress-signal check in §7.6. `fetch(externalUrl)` does NOT auto-grant. |

---

## 16. Out of scope for this PR sequence

| Follow-up | Trigger |
|---|---|
| Legacy `buildMcpToolDefinitions` deletion | 2+ weeks of new-path stability in production |
| `list_connectors` (keyword) | Rendered catalog × per-turn cost exceeds budget |
| `list_connectors` (semantic + embedding index) | Catalogs reach hundreds of entries |
| OAuth 2.1 + PKCE | First OAuth-only vendor becomes mandatory |
| Pre-spawn LLM router | Catalog approaches 200+ entries org-wide |
| Trust state machine | Phase 2 |
| Public registry sync (mcp.so) | Phase 2 |
| Token broker (scoped credentials) | Phase 2 — highest-leverage security move |
| Generation-on-miss + sandbox | Phase 3 |
| Validator pipeline | Phase 3 |
| Auto-applied tier changes | After curation suggestions prove low false-positive rate |

---

## 17. Open decisions

Can be locked during implementation:

1. **Approval-storm cap default** — 15 vs 20 novel prompts per run. Recommend 20; tune from dogfood data.
2. **Runaway-loop cap default** — 300 total invocations. Likely fine; revisit if data agents complain.
3. **Curation job cadence** — daily vs weekly. Recommend daily; cheap to run.
4. **Demote threshold N** — 30 runs idle = stale. Tune from prod.
5. **Promote thresholds V, E** — exact volume × error-rate weighting. Output of measurement PR.
6. **Args redaction policy** — per-org list of sensitive arg keys. Default redacts `password`, `token`, `secret`, `apiKey`.
7. **Egress-signal classifier** — heuristics for "external host," "messaging target," "file write path." Conservative defaults; tunable.

---

## 17.5 Channel attachment + discovery tools (Phase 1.5, additive to the dispatch substrate)

Two extensions added on top of §1–§17. **Per-agent attachment is preserved unchanged.** Channel attachment is added as a peer bulk-grant layer. Discovery beyond the effective set is provided by two plain tools — not a runtime agent. The prior draft of this section proposed an "IT guy" agent; that was redundancy (one LLM asking another to do a lookup the first one can do itself the moment it has the search tool) and is dropped. The UX label "Ask IT" can remain over the tools — it's a label, not a process.

### 17.5.1 Why channel attachment (without removing per-agent)

Per-agent attachment is precise but a chore at scale. An OSINT team with 5 agents needs the same 10 MCPs attached 5 times. Adding the 11th MCP = 5 more clicks. That chore is the user-visible pain.

Channels are already the unit of collaboration in Ujima — they carry purpose, members, history. Attaching MCPs at the channel level encodes the trust boundary at the same scope as the work itself, while per-agent attachment remains the override for the "Snoop alone gets X" case.

**Effective MCP set at spawn = channel attachments ∪ per-agent attachments.** Computed inside V2 (§7.4). Legacy `buildMcpToolDefinitions` continues to read per-agent only, preserving §3.5 rule 1 byte-for-byte.

### 17.5.2 Schema additions (additive only)

New table: `channel_mcp_attachments`. Same shape as `agent_mcp_attachments` but keyed on `(channelId, mcpServerId)`. Carries the same `scope` (worker/supervisor/both) and `tier` (native/dispatch) columns.

Existing `agent_mcp_attachments` rows stay byte-for-byte unchanged. Channel attachment is purely additive.

### 17.5.3 Effective set computation (inside V2 only)

```
effective = []
for each channel agent is a member of:
  for each channel attachment matching agent's role:
    effective.append(attachment, source: 'channel', channelId)
for each per-agent attachment:
  effective.append(attachment, source: 'agent')
deduplicate by mcpServerId:
  1. If a per-agent attachment exists, it WINS ENTIRELY — tier included.
     (Precision overrides bulk. The operator's deliberate per-agent tier
     choice — "Snoop is on dispatch for Slack to save tokens" — is
     preserved against channel fan-out that would otherwise silently
     reverse it.)
  2. Channel-only conflicts (two channels claim the same MCP at
     different tiers) -> DISPATCH WINS.
     (Dispatch is lossless — capability is fully reachable through
     invoke_connector_tool with zero per-tool palette cost. Native
     promotion is a deliberate act, never an accident of channel
     membership. This is the rule that prevents native ballooning from
     cross-channel attachment fan-out.)
```

The `source` is preserved on the resolved set so the trajectory and approval card can show *why* an agent has access ("from #investigations" vs "Snoop-only").

### 17.5.4 Two catalogs, two exposure strategies

The asking agent encounters two different catalogs at two different scales:

- **Effective catalog** = channel ∪ per-agent attachments. Tens of entries. Fits in the prompt → rendered as catalog text per §6.5 phase-1.
- **Discovery catalog** = org-wide attached MCPs ∪ Ujima-curated marketplace. Potentially hundreds or thousands. Does NOT fit in the prompt → exposed only via search, never dumped wholesale.

Same reasoning as §6.5; the discovery catalog has already crossed the phase-2 trigger threshold simply by being bigger. Two sizes, two exposure strategies, applied from day one.

### 17.5.5 Two tools, not an agent: `search_catalog` + `request_attachment`

The discovery escalation collapses to two deterministic tools registered in V2 spawn next to `get_connector_tools` / `invoke_connector_tool`. No second LLM in the chain, no agent provisioning, no recommendation cache (nothing to amortize).

**`search_catalog(query: string) -> { matches: Array<CatalogMatch>, hasMore: boolean }`**
- Searches the discovery catalog (org-wide ∪ marketplace).
- Returns top-K matches (default K=10) with name, category, structural facts or curated description (§17.5.7), and an `isAttachedToEffectiveSet` flag.
- No side effects, no permission gate.
- Implementation: keyword + tag scoring over indexed catalog rows. Semantic retrieval is the §6.5 phase-3 upgrade.

**`request_attachment(serverId, target: 'channel' | 'agent', targetId, reason) -> { requestId, status }`**
- Surfaces the attachment approval card (§17.5.6).
- The `reason` field carries the **asking agent's own reasoning** — one LLM, one trajectory, one consent chain.
- On approval, writes the attachment row (`channel_mcp_attachments` or `agent_mcp_attachments`).
- Does NOT invoke any tool. Invocation is a separate decision (§17.5.6).

**Why no agent.** An IT-guy LLM whose job is to match an intent to a catalog entry would be one model asking a second to do a lookup the first can do directly given the same tool. Extra hop, second invocation, cache, provisioning, confused-deputy surface — all to avoid handing the asking agent a search tool. The asking agent's reasoning belongs in its trajectory, not split across two agents.

The "Ask IT" UX framing survives. Label the tools "Ask IT" / "Browse the IT catalog" in the trajectory and operator surfaces if the metaphor is product-valuable. That's a label on a deterministic tool, not a runtime agent.

### 17.5.6 Approval card — attachment grant and action grant are separate

The §5.2 lesson — consent and capability must be the same object — applies here too. A combined "Attach + Always" button re-opens the loophole: the operator approves *this Censys action*, but "Always" silently grants every future Censys call channel-wide. Two grants, two scopes, displayed independently:

```
+- Snoop wants to attach and use a new connector --------------------+
| [shield] New connector                                             |
|                                                                    |
| Reason (from Snoop):                                               |
|   "Need SSL cert history for example.com. None of the attached     |
|    connectors cover this; search_catalog returned Censys."         |
|                                                                    |
| GRANT 1 — Attachment                                               |
|   Attach Censys to:                                                |
|     (o) Snoop only  (default — least privilege)                    |
|     ( ) #investigations  (3 agents would benefit)                  |
|     ( ) Do not attach                                              |
|                                                                    |
| GRANT 2 — First action (independent of GRANT 1's "Always")         |
|   Run: cert.search(query="example.com")                            |
|     (o) Allow once                                                 |
|     ( ) Allow for this run                                         |
|     ( ) Always allow cert.search                                   |
|     ( ) Don't run                                                  |
|                                                                    |
|  [Confirm both]  [Reject all]                                      |
+--------------------------------------------------------------------+
```

Scopes are independent:
- **Attachment** = bulk reachability for the chosen target. Persistent until explicitly removed.
- **Action** = same per-action semantics as §5.2. "Always allow cert.search" grants `(agent, server, toolName)` in the permission store — NOT a tier change, per the orthogonality invariant in §9.3.

If operator selects "Do not attach" on Grant 1, Grant 2 cannot run — the form prevents Confirm. If "Allow once" on Grant 2, future `cert.search` calls re-prompt at the §5.2 action card.

### 17.5.7 Structural-facts rule extends to tool results

§7.2 said: external un-curated MCP descriptions never reach the **system prompt** verbatim. The same risk applies to **tool results** from `search_catalog`. A tool result is lower-authority than the system prompt but still model-readable text — an injected description in it can still steer the model.

One sanitization policy, two consumption surfaces:
- `search_catalog` returns curated descriptions verbatim only for MCPs in `CURATED_REGISTRY` or with explicit admin-curated descriptions.
- For un-curated external entries, the match returns structural facts only (name, category, tool count, tool names — no prose).
- The system-prompt catalog renderer (§7.2) uses identical rules.

Both surfaces call the same `renderCatalogEntry(entry, mode)` helper. One bug, one fix, both surfaces close.

### 17.5.8 When a runtime agent would be justified (deferred)

Not in Phase 1.5. The work that genuinely requires an agent — judgment over whether a team should get a connector category, license/cost checks, near-duplicate marketplace dedup — is policy work the asking agent has a conflict of interest about. The operator handles this today at the approval card. Automating it is the Phase-2 trust state machine work, and even then it would be a policy engine, not a chat agent. Revisit only when the goal is to take the human out of attach-approval.

The "self-building marketplace" property survives unchanged: agent searches → requests → operator approves → connector attached → effective surface grows. Only the LLM middleman is removed.

### 17.5.9 What changes in the user flow

Admin flow (§4.1) gains a channel step:

```
Admin -> Channels -> #investigations -> Settings -> MCPs
      -> Attach Shodan, WHOIS, Wayback to this channel
      -> Every agent in #investigations inherits them automatically
      -> Per-agent overrides remain available for exceptions
```

Operator flow (§4.2) gains discovery via tool (not via a second agent):

```
Snoop in #investigations: needs SSL cert history
  -> Effective catalog: Shodan, WHOIS, Wayback. None fit.
  -> Snoop calls search_catalog("SSL cert history")
  -> Top-K returns: Censys (cert.search), CertSpotter, ...
  -> Snoop calls request_attachment(
        serverId="censys", target="channel",
        targetId="#investigations",
        reason="None of the attached connectors cover SSL cert history.")
  -> Operator sees ONE card with TWO independent grants.
  -> Confirm both. Attachment row written.
  -> Snoop calls invoke_connector_tool("censys", "cert.search", {...})
     in the same run (no LoopExit, no rebuild — dispatch invariant holds).
  -> Every future agent in #investigations sees Censys too.
```

### 17.5.10 Files added / touched (Phase 1.5)

New backend:
- `packages/orchestrator/src/services/channel-mcp-attachments.ts`
- `packages/orchestrator/src/tools/search-catalog.ts`
- `packages/orchestrator/src/tools/request-attachment.ts`
- Shared helper `renderCatalogEntry(entry, mode)` used by both `search_catalog` results and the §7.2 system-prompt renderer.
- `ChannelMcpAttachmentSchema` in [packages/shared/src/org-schemas.ts](packages/shared/src/org-schemas.ts)

Modified backend (still respecting §3.5):
- `buildMcpToolDefinitionsV2` — adds the union/dedup step + registers `search_catalog` + `request_attachment`. Legacy `buildMcpToolDefinitions` untouched.
- [packages/permissions/src/index.ts](packages/permissions/src/index.ts) — handles `attachment_request` resolution and writes the row on approval.

New frontend:
- Channel settings → MCPs tab (mirrors agents-subtab from PR 6).
- Approval card `kind: 'attachment_request'` variant rendering the two independent grants.

**Removed from the prior 17.5 draft:** no `it-guy.ts`, no IT-guy agent provisioning, no recommendation cache, no IT-guy org-chart membership, no IT-guy degradation/fallback logic. All gone.

### 17.5.11 Open decisions (Phase 1.5)

1. **Discovery catalog scope** — Phase 1.5 ships Ujima-curated marketplace + org-wide attached MCPs. Community / mcp.so registry deferred to the Phase-2 trust state machine.
2. **Search index** — keyword + tag scoring on catalog rows; semantic retrieval is the §6.5 phase-3 upgrade. Ranking weights tuned from telemetry.
3. **Top-K default** — K=10 covers most queries without dumping. Tunable.
4. **Attachment-card default radio** — Recommend **asking agent only** (narrow) as the default selection, with current channel one click away. Least-privilege beats convenience here: channel attachment already has its own dedicated admin surface in Settings → Channels → MCPs for bulk setup, so mid-run ad-hoc discovery should default to the narrowest grant that lets the agent proceed. The broad channel grant stays a deliberate operator choice, not a default nudge. (Earlier drafts of this doc recommended the opposite; flipped after a reviewer pointed out that defaulting to broad nudges every "Allow once" into a persistent channel-wide grant.)
5. **"Ask IT" UX label** — keep the metaphor in trajectory copy + approval cards even though there is no runtime agent behind it? Recommend yes; it's a label, not a process. A/B test once it ships.

---

## 18. Implementation order — split across PRs

[CONTRIBUTING.md:45](CONTRIBUTING.md#L45) sets a 500-line aim and a 2000-line hard cap (insertions only). Sequenced into eleven PRs (including the measurement PR and the two Phase-1.5 additions), each independently reviewable, revertable, and leaving the system in a working state. A twelfth (legacy-removal) is deferred to a separate cycle.

Every PR obeys §3.5. With the flag off, every PR is a no-op for users.

### PR 1 — Substrate (~250 lines, zero behavior change)

- Schema migration on `agent_mcp_attachments`: add `tier TEXT NOT NULL DEFAULT 'native'`.
- Audit table gains `server_id`, `tool_name`, `args_json` + indexes.
- `AgentMcpAttachmentSchema` adds `tier`.
- Repository: `saveAgentMcpAttachment` accepts new field; `updateAttachmentTier` method.
- Per-model `estimateToolPaletteTokens` helper.
- Feature flag scaffold: `mcp.discoverableConnectors.enabled`, default off.
- Unit tests.

Nothing reads `tier` yet. Audit columns NULL on every row.

### PR 2 — Registry expansion (~300 lines, additive only)

Track A remote-hosted + Track B reference stdio. Pure data.
- New optional fields on `RegistryEntry`: `transportKind`, `authMode`, `setupHint`, `lastVerified`, `curatedDescription`.
- Remote PAT-only entries: GitHub, Linear, Sentry, Supabase, Vercel, Context7.
- Stdio reference entries: Memory, Sequential Thinking, Fetch.
- OAuth-only entries (Atlassian, Notion remote): listed, `instantiateFromRegistry` throws "OAuth not yet supported."
- Tests for new field defaults and OAuth-throws.

Benefits the legacy path immediately.

### PR 3 — Catalog renderer (~300 lines, zero behavior change)

- New module `packages/orchestrator/src/services/connector-catalog.ts`.
- `resolve(...) -> { native, dispatchCatalog, catalogText }`.
- Render rules: curated → full description; un-curated → structural facts only.
- Unit tests cover partition, structural-facts fallback, curated rendering.

Orphaned. Ready for PR 5.

### PR 4 — Meta-tools (~350 lines, behind flag, inert)

- New module `packages/orchestrator/src/tools/connector-meta-tools.ts`:
  - `get_connector_tools(serverId)` — pure read.
  - `invoke_connector_tool(serverId, toolName, args)` — server-side schema validation + action-level permission gate + MCP call.
- No `list_connectors` (deferred — §6.5).
- Permission gate accepts the new shape (real `toolName`, real `args`); no synthetic `request_connector:<id>` routing.
- Egress-signal classifier in `classify(serverId, toolName, args)`.
- Auto-grant rule per §7.6.
- Registered only by V2 spawn (PR 5).

Legacy path doesn't import this module.

### PR 4.5 — Measurement PR (~200 lines, diagnostic only)

The empirical gate.
- New harness `scripts/dispatch-measurement.ts` runs 3 models × 10 tasks × 2 configs.
- Records per (model, tool): success rate, turns-to-success, validation-error rate, get_connector_tools round-trip rate.
- Output JSON report committed to `docs/measurements/`.
- Initial default native-promotion list seeded from the report.

Runs in CI on demand, not blocking.

### PR 5 — V2 spawn wire (~100–150 lines, behind flag)

The technical centerpiece. **~80% smaller than the discovery plan's PR 5** because there's no LoopExit, no rebuild, no `ai-sdk-loop.ts` changes.

- New method `buildMcpToolDefinitionsV2` next to legacy. Legacy is byte-for-byte unchanged.
- Caller branches on the flag. Tier is read **inside V2 only** (per §3.5 rule 3).
- V2: partitions attachments by tier; native → existing palette path; dispatch → catalog entries.
- Registers `get_connector_tools` + `invoke_connector_tool`.
- System prompt builder gains optional `availableConnectors` input; only V2 passes it.
- Integration test: legacy stays green; V2 produces partitioned palette + working invocation.

### PR 6 — API + settings UI tier toggle (~400 lines)

- `PATCH /api/orgs/:orgId/agents/:memberId/mcp-attachments/:serverId` accepts `tier`.
- Settings UI gains the tier toggle column.
- New components: `attachment-tier-toggle.tsx`, `palette-budget-meter.tsx`, `curation-suggestions-panel.tsx`.
- `mcp-attach-modal.tsx` defaults new attachments to `dispatch` when flag is on.
- [use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts) gains `tier` + `updateAttachmentTier` mutation.
- Curated-description field with attach-time lint.
- Playwright.

### PR 7 — Approval card + timeline + audit-write unwrap (~400 lines)

- Audit-write layer in [packages/permissions/src/index.ts:115](packages/permissions/src/index.ts#L115) populates the new `server_id`, `tool_name`, `args_json` columns.
- `ApprovalCardData` gains `kind: 'action_request'`. New variant shows server + tool + args inline.
- `approvalToCard` maps from the unwrapped audit row.
- New timeline components: `connector-catalog-row.tsx`, `connector-action-row.tsx`. Read from the unwrapped audit shape.
- VSCode extension mirrors.

### PR 8 — Telemetry + dogfood enable (~200 lines)

- All §12 events wired.
- Feature flag flipped on for internal dogfood org.
- ADR in [docs/adr](docs/adr).
- Curation job (cron) scaffolded but suggestions-only.

### PR 9 — Bidirectional curation job (~250 lines, deferred 2 weeks after PR 8)

- Scheduled job reads audit data, writes `tier_curation_suggestions`.
- Demote candidates: native + idle for N runs.
- Promote candidates: dispatch + volume × error-rate above threshold.
- Suggestions surface in settings panel from PR 6.
- No auto-apply this PR.

### PR 10 — Channel-attached MCPs (~350 lines, additive)

The bulk-attachment fix. Per-agent attachment stays exactly as it is.

- Schema: `channel_mcp_attachments` table + indexes + Zod `ChannelMcpAttachmentSchema`.
- Repository: save / list / update / delete for channel attachments.
- `buildMcpToolDefinitionsV2` gains the union/dedup step from §17.5.3. Legacy `buildMcpToolDefinitions` is **not** touched — still per-agent only.
- API: `PATCH /api/orgs/:orgId/channels/:channelId/mcp-attachments/:serverId`.
- Frontend: channel settings → MCPs tab. Mirrors the agents-subtab shape from PR 6; new attachments default to `dispatch` tier when the flag is on.
- Trajectory: catalog row indicates `source: 'channel' | 'agent'` per resolved attachment so operators see *why* an agent has access.
- Integration tests: union dedup, per-agent wins on conflict, tier conflict resolution, role-scoped union.

Backwards-compatible because channel attachments are read only by V2. With the flag off, the column exists but contributes nothing.

### PR 11 — Discovery tools + attachment card (~250 lines)

The discovery escalation, with the IT-guy agent removed.

- `tools/search-catalog.ts`: keyword + tag scoring over org-wide attached MCPs ∪ Ujima-curated marketplace. Returns top-K with `isAttachedToEffectiveSet` flag. No side effects, no gate.
- `tools/request-attachment.ts`: surfaces the approval card; on approval writes the attachment row (channel or per-agent) via the existing permission middleware.
- Shared helper `renderCatalogEntry(entry, mode)` used by both `search_catalog` results and the §7.2 system-prompt renderer — one sanitization policy, two surfaces.
- Permission middleware: handles `attachment_request` resolution. Two grants (attachment scope + action scope) are resolved together but scoped independently — see §17.5.6.
- Approval card: new `kind: 'attachment_request'` variant rendering the two grants as separate sections. No combined "Attach + Always" button.
- Audit events: `catalog_search`, `attachment_request_created`, `attachment_request_resolved`. All carry the unwrapped tuple per §12.
- Marketplace surface: read-only Ujima-curated catalog this PR. Community / mcp.so deferred to Phase-2 trust state machine.
- Integration tests: search returns expected matches; attachment_request writes the row on approval; rejection blocks invocation; structural-facts fallback fires on un-curated entries in both surfaces.

**Removed from the prior PR-11 draft:** `it-guy.ts` service, `ask_it_guy` tool, IT-guy agent provisioning, recommendation cache, fallback/degradation logic, org-chart membership. ~150 lines avoided.

### PR 12 — Legacy removal (deferred, separate cycle)

Triggered only after 2+ weeks stable in production with zero new-path regressions. Deletes legacy `buildMcpToolDefinitions`, caller branching, flag, shims.

### Total

~3250 added lines across 11 PRs (excluding deferred PR 12), averaging ~295 each. No PR exceeds 500. Biggest single PR (5) still shrinks ~80% vs the discovery plan. [packages/agent-runtime/src/ai-sdk-loop.ts](packages/agent-runtime/src/ai-sdk-loop.ts) is **not touched** in any of the 11 PRs.

---

## Appendix A — What survives from the discovery plan verbatim

- §3.5 backward-compatibility contract.
- Track A registry expansion (PR 2).
- Audit/telemetry spine through `packages/event-bus` and the audit table (with the §12 unwrap addition).
- Approval-card and timeline UI surfaces (PR 7), retargeted from connectors to actions.
- Per-org budget config for the native palette readout.
- Strangler rollout + kill-switch discipline.

## Appendix B — What dies from the discovery plan

- `request_connector` meta-tool. Replaced by `invoke_connector_tool`.
- `mode: 'always_on' | 'discoverable'` column. Renamed `tier: 'native' | 'dispatch'`.
- Section 8 — mid-loop activation handshake. **Deleted.**
- LoopExit `connector_activated` reason. Not introduced.
- `buildMcpToolDefinitionsV2` doing the full schema injection on activation. V2 does tier partition only.
- The 40-entry catalog cap. Dispatch is architecturally unbounded.
- `list_connectors` (Phase 1). Deferred until Phase 2 trigger.
- Connector-scope `allow_always` mutating attachment row. Replaced by per-(server, tool) grant cache.
- Auto-grant on every read-only server. Replaced by egress-aware classification.

## Appendix C — Files most likely to change

Backend:
- [packages/shared/src/org-schemas.ts](packages/shared/src/org-schemas.ts) — `tier` field.
- [packages/runtime-core/src/repositories/mcp-servers.ts](packages/runtime-core/src/repositories/mcp-servers.ts) — repo methods.
- [packages/context-store/src/db.ts](packages/context-store/src/db.ts) — schema migrations.
- [packages/orchestrator/src/services/connector-catalog.ts](packages/orchestrator/src/services/connector-catalog.ts) — new.
- [packages/orchestrator/src/tools/connector-meta-tools.ts](packages/orchestrator/src/tools/connector-meta-tools.ts) — new.
- [packages/orchestrator/src/services/spirit-agent-run.ts](packages/orchestrator/src/services/spirit-agent-run.ts) — sibling V2 method; legacy unchanged.
- [packages/orchestrator/src/services/spirit-mcp-helpers.ts](packages/orchestrator/src/services/spirit-mcp-helpers.ts) — per-model tokenizer.
- [packages/orchestrator/src/utils/system-prompt-builder.ts](packages/orchestrator/src/utils/system-prompt-builder.ts) — optional catalog input.
- [packages/permissions/src/index.ts](packages/permissions/src/index.ts) — action-level gate + audit-write unwrap.
- [packages/agent-runtime/src/ai-sdk-loop.ts](packages/agent-runtime/src/ai-sdk-loop.ts) — **NOT modified**.
- [apps/api/src/transport](apps/api/src/transport) — new endpoints.

Frontend:
- [apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx](apps/web/src/features/settings/organization/components/mcps/agents-subtab.tsx)
- [apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx](apps/web/src/features/settings/organization/components/mcps/mcp-attach-modal.tsx)
- [apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts](apps/web/src/features/settings/organization/components/mcps/use-mcp-catalog.ts)
- [apps/web/src/features/workspace/components/chat/approval-card.tsx](apps/web/src/features/workspace/components/chat/approval-card.tsx)
- [apps/web/src/features/workspace/approval-card-data.ts](apps/web/src/features/workspace/approval-card-data.ts)
- [apps/web/src/features/workspace/use-conversation-sync.ts](apps/web/src/features/workspace/use-conversation-sync.ts)
- [apps/vscode-extension](apps/vscode-extension) — mirror surfaces.
