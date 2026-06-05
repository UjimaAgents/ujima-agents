// Feature-flag scaffold for the dispatch-plan rollout
// (mcp_connector_dispatch_plan.md §3.5 rule 3, §13.2 rollout).
//
// The dispatch plan demands a single routing switch between the legacy
// spawn path and the V2 spawn path. With the flag off the system runs
// the byte-for-byte unchanged legacy `buildMcpToolDefinitions` and
// every dispatch-only surface (meta-tools, tier toggle, approval-card
// kinds) stays dark. Flip the flag on per-org once the V2 path is
// proven in dogfood.
//
// Implementation mirrors the existing env-var pattern used elsewhere
// in this package (UJIMA_TRAJECTORY_LOG, UJIMA_HOME). A formal
// feature-flag store can swap in later without callers changing — they
// all go through `isMcpDispatchEnabled()`.
//
// `truthy` accepts the common shell idioms operators reach for so the
// flag isn't silently off because someone wrote `UJIMA_MCP_DISPATCH=true`
// expecting it to match the docs.

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

// The dispatch plan's only routing switch (§3.5 rule 3). Returns true
// when the V2 spawn path should run; false (the default) means the
// legacy `buildMcpToolDefinitions` runs unchanged. Reading is cheap so
// callers re-check per spawn rather than caching — that keeps the kill
// switch reaction time at "next spawn" rather than "next process restart".
export function isMcpDispatchEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthy(env.UJIMA_MCP_DISPATCH);
}
