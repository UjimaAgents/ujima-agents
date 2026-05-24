import {
  isTestMcpResponse,
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/mcps/${encodeURIComponent(id)}/test?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "POST" },
    "Unable to test MCP server.",
    { forwardStructuredError: isTestMcpResponse },
  );
}
