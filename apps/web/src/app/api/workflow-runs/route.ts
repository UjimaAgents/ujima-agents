import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  const path = status ? `/api/workflow-runs?status=${encodeURIComponent(status)}` : "/api/workflow-runs";
  return proxyDaemonHttpRoute(path, {}, "Unable to list workflow runs.");
}
