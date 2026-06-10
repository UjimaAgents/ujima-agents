// Feature-flag scaffold for the dispatch-plan rollout
// (mcp_connector_dispatch_plan.md §3.5 rule 3, §13.2 rollout).
//
// The dispatch plan demands a single routing switch between the legacy
// spawn path and the V2 spawn path. With the flag off the system runs
// the byte-for-byte unchanged legacy `buildMcpToolDefinitions` and
// every dispatch-only surface (meta-tools, tier toggle, approval-card
// kinds) stays dark.
//
// Two ways to flip it on:
//
//   1. UJIMA_MCP_DISPATCH=true — process-wide kill switch in either
//      direction. Useful for local dev and for the eventual flip to
//      "default on" once V2 is proven (§13.2 Week 6+).
//   2. UJIMA_MCP_DISPATCH_ORG_ALLOWLIST=org_a,org_b — comma-separated
//      list of organisationIds that get V2 even when the process-wide
//      switch is off. This is the §13.2 mechanism for dogfood (PR 8),
//      then pilot orgs (Week 4), then per-tenant rollout (Week 6+).
//      Keeping it as a deployment-time env var rather than a per-org
//      DB column means an operator who needs to take an org off V2
//      can do it without a release.
//
// `truthy` accepts the common shell idioms operators reach for so the
// flag isn't silently off because someone wrote `UJIMA_MCP_DISPATCH=true`
// expecting it to match the docs.

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function parseOrgAllowlist(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

// The dispatch plan's only routing switch (§3.5 rule 3). Returns true
// when the V2 spawn path should run; false (the default) means the
// legacy `buildMcpToolDefinitions` runs unchanged. Reading is cheap so
// callers re-check per spawn rather than caching — that keeps the kill
// switch reaction time at "next spawn" rather than "next process restart".
//
// The optional `organizationId` argument enables per-org rollout: when
// the process-wide switch is off, V2 still runs for orgs whose id is
// in `UJIMA_MCP_DISPATCH_ORG_ALLOWLIST`. Callers that don't have an
// org context (legacy code paths, tests) can omit it and get the old
// kill-switch-only behavior.
export function isMcpDispatchEnabled(
  organizationId?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (truthy(env.UJIMA_MCP_DISPATCH)) return true;
  if (!organizationId) return false;
  return parseOrgAllowlist(env.UJIMA_MCP_DISPATCH_ORG_ALLOWLIST).has(organizationId);
}
