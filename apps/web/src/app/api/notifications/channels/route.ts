import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyDaemonHttpRoute("/api/notifications/channels", {}, "Unable to list notification channels.");
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  return proxyDaemonHttpRoute(
    "/api/notifications/channels",
    { method: "POST", body: JSON.stringify(payload) },
    "Unable to create notification channel.",
  );
}
