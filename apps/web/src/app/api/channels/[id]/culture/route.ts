import {
  missingOrganizationIdResponse,
  organizationIdFromJsonBody,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  const { id } = await params;
  return proxyDaemonRoute(
    organizationId,
    `/api/channels/${encodeURIComponent(id)}/culture?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    "Unable to load channel culture.",
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  const { id } = await params;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/channels/${encodeURIComponent(id)}/culture`,
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to save channel culture.",
  );
}
