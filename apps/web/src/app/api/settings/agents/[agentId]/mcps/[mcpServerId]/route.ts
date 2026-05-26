import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ agentId: string; mcpServerId: string }> },
) {
  const { agentId, mcpServerId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
    "Unable to detach MCP server.",
  );
}
