import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string; name: string }> };

async function proxyChannelProcedure(
  request: Request,
  { params }: RouteContext,
  init: RequestInit,
  fallbackMessage: string,
) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  const { id, name } = await params;
  return proxyDaemonRoute(
    organizationId,
    `/api/channels/${encodeURIComponent(id)}/culture/${encodeURIComponent(name)}?organizationId=${encodeURIComponent(organizationId)}`,
    init,
    fallbackMessage,
  );
}

export function GET(request: Request, context: RouteContext) {
  return proxyChannelProcedure(
    request,
    context,
    {},
    "Unable to load procedure.",
  );
}

export function DELETE(request: Request, context: RouteContext) {
  return proxyChannelProcedure(
    request,
    context,
    { method: "DELETE" },
    "Unable to remove procedure.",
  );
}
