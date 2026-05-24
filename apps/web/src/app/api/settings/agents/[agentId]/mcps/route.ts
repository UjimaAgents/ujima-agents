import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/mcps?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to fetch agent MCP attachments.",
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/mcps`,
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to attach MCP server.",
  );
}
