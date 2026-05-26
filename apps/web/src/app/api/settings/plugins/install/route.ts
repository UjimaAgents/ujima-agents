import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    "/api/settings/plugins/install",
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to install skill.",
  );
}
