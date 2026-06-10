import {
  organizationIdFromJsonBody,
  proxyDaemonRoute,
} from "@/server/proxy-daemon-route";

// PR 9 — operator decision persistence (§9.4). The panel calls this
// after a successful Apply so the suggestion's status flips to
// `applied` in the suggestions table. Without this proxy the
// optimistic-removal in the panel is the ONLY signal — a refresh
// would resurface the row.

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  const { suggestionId } = await params;
  const parsed = await organizationIdFromJsonBody(request);
  if (parsed instanceof Response) return parsed;
  return proxyDaemonRoute(
    parsed.organizationId,
    `/api/settings/mcps/tier-curation-suggestions/${encodeURIComponent(suggestionId)}`,
    { method: "PATCH", body: JSON.stringify(parsed.payload) },
    "Unable to update suggestion status.",
  );
}
