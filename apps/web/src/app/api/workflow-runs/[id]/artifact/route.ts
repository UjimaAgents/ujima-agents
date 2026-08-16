import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") ?? "";
  return proxyDaemonHttpRoute(
    `/api/workflow-runs/${encodeURIComponent(id)}/artifact?path=${encodeURIComponent(path)}`,
    {},
    "Unable to load artifact.",
  );
}
