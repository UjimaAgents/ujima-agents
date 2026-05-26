import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/mcps/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(parsed.payload) },
    "Unable to update MCP server.",
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/mcps/${encodeURIComponent(id)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
    "Unable to delete MCP server.",
  );
}
