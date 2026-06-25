import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/governance/policy/tool-rule`,
    { method: "PATCH", body: JSON.stringify(parsed.payload) },
    "Unable to update tool rule.",
  );
}
