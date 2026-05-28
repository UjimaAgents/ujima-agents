import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/agents/${encodeURIComponent(agentId)}/tools?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to fetch agent tool grants.",
  );
}
