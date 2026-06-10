import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 10 — channel attachment detach proxy (§17.5).

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  {
    params,
  }: { params: Promise<{ channelId: string; mcpServerId: string }> },
) {
  const { channelId, mcpServerId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/channels/${encodeURIComponent(channelId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
    "Unable to detach MCP server from channel.",
  );
}
