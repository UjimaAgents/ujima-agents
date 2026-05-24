import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/mcps?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to fetch MCP servers.",
  );
}

export async function POST(request: Request) {
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    "/api/settings/mcps",
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to create MCP server.",
  );
}
