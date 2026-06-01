import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  const url = new URL(request.url);
  const agentId = url.searchParams.get("agentId");
  const role = url.searchParams.get("role");
  const qs = new URLSearchParams({ organizationId });
  if (agentId) qs.set("agentId", agentId);
  if (role === "worker" || role === "supervisor") qs.set("role", role);
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/mcps/catalog?${qs.toString()}`,
    {},
    "Unable to fetch MCP catalog.",
  );
}
