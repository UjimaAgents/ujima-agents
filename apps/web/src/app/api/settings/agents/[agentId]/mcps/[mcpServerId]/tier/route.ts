import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 6 tier toggle proxy (mcp_connector_dispatch_plan.md §17.5).
// The Fastify route at /api/settings/agents/:agentId/mcps/:mcpServerId/tier
// exists; without this Next.js handler the web's PATCH never reached
// the daemon and 404'd against the wildcard mcps/[mcpServerId] route
// (which only registers DELETE).

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ agentId: string; mcpServerId: string }>;
  },
) {
  const { agentId, mcpServerId } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/mcps/${encodeURIComponent(mcpServerId)}/tier`,
    { method: "PATCH", body: JSON.stringify(parsed.payload) },
    "Unable to update connector tier.",
  );
}
