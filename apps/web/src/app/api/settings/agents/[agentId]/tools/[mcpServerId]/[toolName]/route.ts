import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ agentId: string; mcpServerId: string; toolName: string }>;
  },
) {
  const { agentId, mcpServerId, toolName } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(mcpServerId)}/${encodeURIComponent(toolName)}`,
    { method: "PUT", body: JSON.stringify(parsed.payload) },
    "Unable to grant tool.",
  );
}

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ agentId: string; mcpServerId: string; toolName: string }>;
  },
) {
  const { agentId, mcpServerId, toolName } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(mcpServerId)}/${encodeURIComponent(toolName)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
    "Unable to revoke tool.",
  );
}
