import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyDaemonHttpRoute(`/api/goals/${encodeURIComponent(id)}`, {}, "Unable to get goal.");
}
