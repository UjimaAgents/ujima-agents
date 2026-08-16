import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyDaemonHttpRoute("/api/workflow-approvals", {}, "Unable to load workflow approvals.");
}
