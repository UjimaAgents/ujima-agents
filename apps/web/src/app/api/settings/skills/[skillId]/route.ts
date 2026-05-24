import {
  missingOrganizationIdResponse,
  organizationIdFromQuery,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const { skillId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  const url = new URL(request.url);
  const argumentsText = url.searchParams.get("arguments") ?? "";
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/skills/${encodeURIComponent(skillId)}?organizationId=${encodeURIComponent(organizationId)}&arguments=${encodeURIComponent(argumentsText)}`,
    {},
    "Unable to load skill from the Ujima daemon.",
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ skillId: string }> },
) {
  const { skillId } = await params;
  const organizationId = organizationIdFromQuery(request);
  if (!organizationId) return missingOrganizationIdResponse();
  return proxyDaemonRoute(
    organizationId,
    `/api/settings/skills/${encodeURIComponent(skillId)}?organizationId=${encodeURIComponent(organizationId)}`,
    { method: "DELETE" },
    "Unable to delete skill.",
  );
}
