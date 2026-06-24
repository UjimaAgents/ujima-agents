// Feature-flag scaffold for the dispatch-plan rollout
// (mcp_connector_dispatch_plan.md §3.5 rule 3, §13.2 rollout).
//
// The dispatch plan demands a single routing switch between the legacy
// spawn path and the V2 spawn path. As of the §13.2 "default on" flip,
// V2 is now the standard spawn path for EVERY org — channel-level MCP
// attachments, the dispatch meta-tools, the tier toggle, and the
// discovery/approval surfaces are live by default.
//
// The switch is now an opt-OUT kill switch:
//
//   1. UJIMA_MCP_DISPATCH=false (or 0/no/off) — process-wide kill
//      switch that drops back to the byte-for-byte unchanged legacy
//      `buildMcpToolDefinitions`. Use it only to mitigate a V2
//      regression without a release; unset/anything-else = V2 on.
//   2. UJIMA_MCP_DISPATCH_ORG_ALLOWLIST=org_a,org_b — comma-separated
//      list of organisationIds that keep V2 even when the process-wide
//      kill switch is engaged. With the default now on this matters
//      only as a "keep these orgs on V2 while everyone else is killed"
//      escape hatch; it does not need to be set for normal operation.
//
// `truthy`/`falsy` accept the common shell idioms operators reach for so
// the kill switch isn't silently ignored because someone wrote
// `UJIMA_MCP_DISPATCH=false` expecting it to match the docs.

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function falsy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return FALSE_VALUES.has(value.trim().toLowerCase());
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
// when the V2 spawn path should run; V2 is now the default, so this
// returns true unless the kill switch explicitly disables it. Reading
// is cheap so callers re-check per spawn rather than caching — that
// keeps the kill switch reaction time at "next spawn" rather than
// "next process restart".
//
// Resolution order:
//   1. UJIMA_MCP_DISPATCH=true (or unset / any non-false value) → V2 on.
//   2. UJIMA_MCP_DISPATCH=false (kill switch engaged) → legacy, EXCEPT
//      orgs in UJIMA_MCP_DISPATCH_ORG_ALLOWLIST which stay on V2.
//
// The optional `organizationId` argument only matters when the kill
// switch is engaged: it lets an operator keep specific orgs on V2 while
// dropping everyone else to legacy. Callers without an org context can
// omit it.
export function isMcpDispatchEnabled(
  organizationId?: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Explicit truthy always wins.
  if (truthy(env.UJIMA_MCP_DISPATCH)) return true;
  // Kill switch engaged — legacy for everyone except allowlisted orgs.
  if (falsy(env.UJIMA_MCP_DISPATCH)) {
    if (!organizationId) return false;
    return parseOrgAllowlist(env.UJIMA_MCP_DISPATCH_ORG_ALLOWLIST).has(
      organizationId,
    );
  }
  // Unset or non-canonical value → V2 is the default.
  return true;
}
