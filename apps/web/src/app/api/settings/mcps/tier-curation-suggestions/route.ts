import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 9 — tier-curation suggestions list endpoint
// (mcp_connector_dispatch_plan.md §9.4). The Fastify route at
// /api/settings/mcps/tier-curation-suggestions returns the org's
// pending demote/promote candidates; this proxy forwards the
// organizationId query string and the daemon session.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/mcps/tier-curation-suggestions?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to fetch tier-curation suggestions.",
  );
}
