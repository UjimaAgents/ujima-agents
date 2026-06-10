# ADR 0003 — MCP connector dispatch: native + dispatch tiers, V2 spawn strangler

- **Status:** Accepted (2026-06-08), in dogfood
- **Supersedes:** none
- **Related:** `mcp_connector_dispatch_plan.md` (the working spec), ADR 0002 (philosophy)

---

## Context

Attaching more than a handful of MCP connectors to an agent burns three budgets at once:

1. **System-prompt budget.** Each connector publishes typed tool schemas. At 60 tools the schemas alone exceed many models' palette budget; the agent's instruction headroom collapses before any user turn.
2. **Model attention budget.** Even when the schemas fit, the model spends turns considering tools it's unlikely to call. Validation-error rates on cheap models climb sharply past ~20 typed tools.
3. **Spawn determinism.** A naive fix — drop tools at spawn time when the budget is hit — varies the palette spawn-to-spawn, which softens reproducibility across runs of the same channel + agent combo.

The discovery plan that preceded this work tried to solve this with a meta-tool that exited the streamText loop, rebuilt the ToolSet, and restarted. That fought the `streamText` binding model (ToolSet is bound at call time), required state surgery across spawn boundaries, and introduced a class of "what if rebuild fails mid-loop" bugs.

## Decision

**Two-tier connector attachment plus a constant-palette V2 spawn.**

- Each `agent_mcp_attachments` row carries a `tier` column: `native` (typed schemas in the palette, always available) or `dispatch` (rendered as catalog text in the system prompt, callable via two meta-tools).
- A new `buildMcpToolDefinitionsV2` resolves attachments by tier. The dispatch tier never enters the palette — it's a fixed pair of meta-tools (`get_connector_tools`, `invoke_connector_tool`) plus a one-shot catalog block in the system prompt.
- The agent loop is unchanged. `streamText` runs once with a constant ToolSet. No `LoopExit`, no rebuild, no restart.
- Tier defaults to `native` for backwards compat. The full rollout (this ADR + PR 7's audit substrate + PR 8's emitters + future PRs) is gated by a single flag, off by default.

The legacy `buildMcpToolDefinitions` and its callers are left byte-for-byte unchanged. V2 is a sibling, not a rewrite. A separate cycle (PR 12, deferred) deletes the legacy path after 2+ weeks stable in production with zero regressions.

## Why

- **Strangler over rewrite.** The legacy spawn path has years of governance, classification, and audit assumptions baked in. Touching it during the rollout means every bug in V2 is also a regression risk on the proven path. Sibling code → flag flip → measure → delete is the safer shape.
- **Tiering matches actual usage.** Most agents have 3-5 connectors they hit constantly (native) and 5-50 they touch occasionally (dispatch). The dispatch tier serves the long tail without taxing the hot path.
- **`streamText` binds ToolSet at call time.** Working around this is expensive. Solving for a constant palette removes the entire class of "rebuild + restart" complexity.
- **Audit grep-ability falls out for free.** With the unwrap PR (#7), `(server_id, tool_name, args_json)` are first-class columns on `audit_events`. Operator queries like "every `slack.post_message` in 24h across all agents" hit an index instead of a metadata blob scan. The catalog-in-system-prompt model preserves this because every dispatch call still goes through the standard permission gate — the audit row is identical to a native call's.

## Rollout

Per `mcp_connector_dispatch_plan.md` §13.2, with this ADR landing alongside PR 8:

- **Day 0:** Migration ships. All attachments backfilled to `tier='native'`. No behaviour change.
- **Day 1–7:** PR 8 emitters run in shadow on the internal dogfood org. Audit data accumulates against the unwrap columns. The §5.2 approval card variant + §5.3 timeline rows surface in chat. No external user impact.
- **Week 2:** Flag flipped on for the dogfood org via `UJIMA_MCP_DISPATCH_ORG_ALLOWLIST`. New attachments default to `dispatch`. Existing rows untouched at `native`.
- **Week 4:** Pilot orgs (3–5) opt in. PR 9 ships the curation suggestions analysis; demote/promote candidates surface in settings.
- **Week 6+:** Per-org rollout, telemetry-gated. `UJIMA_MCP_DISPATCH=true` flips the process-wide default once we have evidence the V2 path is solid across heterogeneous tenants.

Rollback at any stage is the same one-line operation: take the org out of the allowlist (or flip the kill switch). `tier='dispatch'` rows become inert metadata on the legacy path — no data migration, no state cleanup.

## What this does *not* decide

- **Discovery / IT-guy agent.** The pre-attachment discovery loop ("which connector should this agent ask for?") is intentionally out of scope for this ADR. The dispatch plan §17 leaves that to PR 11; this ADR ships the substrate and stops.
- **Bulk channel attachment.** Channel-scoped MCP attachments (so a channel can grant access to all members at once) are PR 10. The schema this ADR introduces accommodates them additively; nothing here forecloses the design.
- **Auto-curation.** PR 9 surfaces demote/promote *suggestions*. Acting on them stays a human decision. Moving to auto-apply is a separate trust state machine decision (Phase 2).

## Measuring success

The signals we'll review at end of dogfood week to decide whether to widen the rollout:

- **Spawn-time budget.** Native-tier palette stays under the per-model budget for every dogfood agent. No spill events (§7.4 step 5) on the hot path.
- **Validation-error rate.** Dispatch-tier `invoke_connector_tool` validation errors stay below 5% of invocations. Higher → the meta-tool schema isn't carrying enough information for the model to format calls correctly, and we revisit the catalog renderer (§7.2).
- **Approval-storm cap.** The 20-novel-prompts cap from §14.2 fires zero times in normal use. If it fires we want to know whether real usage is producing it or a bug is.
- **Operator queries land.** A live audit query like `SELECT count(*) FROM audit_events WHERE tool_name = 'post_message' AND created_at >= datetime('now', '-1 day')` returns results in <100ms against `idx_audit_tool`.
- **No regressions on the legacy path.** Orgs not in the allowlist see identical behaviour to pre-PR-1.

If any of these fail, the kill switch flips and we revisit before widening the rollout. The flag-only design exists for exactly this.
