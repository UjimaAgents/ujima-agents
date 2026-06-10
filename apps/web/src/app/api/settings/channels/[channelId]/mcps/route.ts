import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 10 — channel-attached MCPs
// (mcp_connector_dispatch_plan.md §17.5). Channels list / attach
// surface. The §17.5.3 union step inside V2 spawn folds every
// channel attachment into the spawning agent's effective set; the
// frontend reads this proxy to render the channels-subtab.

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/channels/${encodeURIComponent(channelId)}/mcps?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to fetch channel MCP attachments.",
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/channels/${encodeURIComponent(channelId)}/mcps`,
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to attach MCP server to channel.",
  );
}
