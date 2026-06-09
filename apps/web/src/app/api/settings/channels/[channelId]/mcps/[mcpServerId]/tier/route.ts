import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 10 — channel attachment tier toggle proxy (§17.5).
// Mirrors the agent-side tier-toggle proxy shape from PR 6 — without
// this Next.js handler the web's PATCH would 404 against the
// wildcard mcps/[mcpServerId] route (which only registers DELETE).

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  {
    params,
  }: { params: Promise<{ channelId: string; mcpServerId: string }> },
) {
  const { channelId, mcpServerId } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/channels/${encodeURIComponent(channelId)}/mcps/${encodeURIComponent(mcpServerId)}/tier`,
    { method: "PATCH", body: JSON.stringify(parsed.payload) },
    "Unable to update channel attachment tier.",
  );
}
