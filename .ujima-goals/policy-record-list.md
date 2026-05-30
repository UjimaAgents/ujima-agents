# Policy Record List -- Settings UI

**Status:** Completed
**Created:** 2026-05-30
**Owner:** Carter Jordan (engineering-manager)

## Goal

Add a "Policy Records" section under **Settings > Organization > Policies** that lists all `state: 'allow'` rules from the governance policy (`.ujima/governance.json`), and allows users to revoke (delete) individual rules.

- "Allow always" = a `ToolPolicyRule` with `state: 'allow'` (explicit permanent approval).
- "Allow family" = a `ToolPolicyRule` with `state: 'allow'` and wildcard patterns (mcp_id: '*', tool_name: '*', tool_name: 'read*').

## Architecture

Web App (Next.js) proxies to API Daemon (Fastify), which reads/writes `.ujima/governance.json` from the workspace root (org.workspace.root).

## Task Breakdown

### Task 1: API Schema -- Add policy-rules types

**File:** `packages/api-schema/src/settings.ts`

- Add `PolicyAllowRuleSchema` -- readable allow-rule record (agent_id, mcp_id, tool_name, state, reason, updated_at, updated_by)
- Add `PolicyRulesResponseSchema` -- array of allow rules
- Add `RevokePolicyRuleSchema` -- body: { agentId, mcpId, toolName }

### Task 2: Orchestrator -- Add governance-policy service methods

**File:** `packages/orchestrator/src/services/settings.ts`

- Add `listAllowRules(organizationId): AllowRule[]`
  - Resolve workspace root from org config
  - Read `.ujima/governance.json` from filesystem (via `node:fs`)
  - Parse via `GovernancePolicy.parse()`
  - Flatten all `state: 'allow'` rules from all agents into a flat list with agent_id attached
- Add `revokeAllowRule(organizationId, agentId, mcpId, toolName): void`
  - Read the governance file
  - Use `removeAgentRule()` to remove the matching rule
  - Write updated governance file back

### Task 3: API Route -- Governance policy rules endpoints

**File:** `apps/api/src/transport/routes/settings.ts`

- `GET /orgs/:orgId/policies/rules` -- returns list of allow rules
- `DELETE /orgs/:orgId/policies/rules` -- revoke a specific rule
- Wire to settings service methods
- Include error handling (org not found, file not found, parse errors)

### Task 4: Next.js Proxy Route

**File:** `apps/web/src/app/api/orgs/[orgId]/policies/rules/route.ts` (new)

- `GET` handler -- proxies to daemon
- `DELETE` handler -- proxies to daemon
- Uses existing `daemonFetch` and `getSessionTokenFromCookie`

### Task 5: Frontend -- Policy Records UI

**Files:**
- `apps/web/src/features/settings/organization/components/policies-tab.tsx` (extend)
- Maybe a new child component file

- New section below existing approval fields:
  - Title: "Policy Records" with description text
  - Table columns: Agent, MCP, Tool, Reason, Granted At, Granted By, Actions
  - Actions column: "Revoke" button per row
  - Empty state: "No permanent allow rules configured."
  - Revoke confirmation dialog before deleting
  - Data fetching on mount
  - Optimistic UI update on revoke

## Key Files to Modify

1. `packages/api-schema/src/settings.ts` -- schemas
2. `packages/orchestrator/src/services/settings.ts` -- service methods
3. `apps/api/src/transport/routes/settings.ts` -- API routes
4. `apps/web/src/app/api/orgs/[orgId]/policies/routes.ts` -- proxy (may need to add GET/DELETE to existing file or create new)
5. `apps/web/src/features/settings/organization/components/policies-tab.tsx` -- UI

## Completed

All 5 tasks are implemented and compiling cleanly:

1. **API Schema** — Added `PolicyAllowRuleSchema`, `PolicyRulesResponseSchema`, `RevokePolicyRuleSchema` to `packages/api-schema/src/settings.ts`
2. **Orchestrator Service** — Added `listAllowRules()`, `revokeAllowRule()`, plus private helpers `readGovernancePolicy()` and `writeGovernancePolicy()` to `SettingsService` in `packages/orchestrator/src/services/settings.ts`. The service reads `.ujima/governance.json` from the workspace root filesystem and uses `removeAgentRule()` from `@ujima/shared` to revoke rules.
3. **API Route** — Added `GET /orgs/:orgId/policies/rules` and `DELETE /orgs/:orgId/policies/rules` to the Fastify settings routes.
4. **Next.js Proxy** — Added `GET` and `DELETE` handlers to `apps/web/src/app/api/orgs/[orgId]/policies/rules/route.ts` that proxy to the daemon. The earlier `/policies` route stays in place for the PATCH endpoint.
5. **Frontend UI** — Extended `PoliciesTab` with a "Policy Records" section showing a table of allow rules (Agent, MCP, Tool, Reason, Granted At, Granted By) with per-row Revoke buttons, a ConfirmDialog for confirmation, loading skeletons, error state with retry, and empty state.

## Questions / Blockers

- The settings service currently uses `ApiRepository`; governance policy needs filesystem access. We may need to inject a filesystem adapter or use `node:fs` directly with the workspace root path.
- The governance policy file may not exist yet (no one set up rules). Handle gracefully with empty response.
- The 404 on `http://localhost:3452/api/orgs/:orgId/policies/rules` came from a missing Next.js proxy route. Added `apps/web/src/app/api/orgs/[orgId]/policies/rules/route.ts` to match the frontend call path.
