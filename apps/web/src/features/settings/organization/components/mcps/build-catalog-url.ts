import type { CatalogRole } from "./use-mcp-catalog";

// Build the catalog endpoint URL. Extracted from useMcpCatalog so the
// query-string contract is testable without React infrastructure.
//
// `role` is load-bearing: the backend filters MCP attachments AND
// per-tool grants by role-match, so an Agents-view refresh that drops
// the role silently collapses worker/supervisor scope into a union
// and the exposed/allowlist indicators can disagree with what the
// runtime palette actually loads.
export function buildCatalogUrl(input: {
  orgId: string;
  agentId?: string;
  role?: CatalogRole;
}): string {
  const qs = new URLSearchParams({ organizationId: input.orgId });
  if (input.agentId) qs.set("agentId", input.agentId);
  if (input.role) qs.set("role", input.role);
  return `/api/settings/mcps/catalog?${qs.toString()}`;
}
