import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await request.json().catch(() => null);
  return proxyDaemonHttpRoute(
    `/api/notifications/channels/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    "Unable to update notification channel.",
  );
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyDaemonHttpRoute(
    `/api/notifications/channels/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    "Unable to delete notification channel.",
  );
}
