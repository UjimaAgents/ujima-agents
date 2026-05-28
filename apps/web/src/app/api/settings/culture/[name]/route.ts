import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ name: string }> };

async function proxyOrgProcedure(
  request: Request,
  { params }: RouteContext,
  init: RequestInit,
  fallbackMessage: string,
) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  const { name } = await params;
  return proxyDaemonRoute(
    organizationId,
    `/api/org/culture/${encodeURIComponent(name)}?organizationId=${encodeURIComponent(organizationId)}`,
    init,
    fallbackMessage,
  );
}

export function GET(request: Request, context: RouteContext) {
  return proxyOrgProcedure(request, context, {}, "Unable to load procedure.");
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyOrgProcedure(
    request,
    context,
    { method: "DELETE" },
    "Unable to remove procedure.",
  );
}
