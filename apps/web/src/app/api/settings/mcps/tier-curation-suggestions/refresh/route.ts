import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 9 — manual analyzer trigger (§9.4). Operators can force a fresh
// run from the panel after applying a tier flip or after a noisy
// run, ahead of the §13.2 cron landing. Daemon-side it's a POST to
// /api/settings/mcps/tier-curation-suggestions/refresh.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/mcps/tier-curation-suggestions/refresh`,
    { method: "POST", body: JSON.stringify(parsed.payload) },
    "Unable to refresh tier-curation suggestions.",
  );
}
