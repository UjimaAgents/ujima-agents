import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const response = await daemonFetch(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }, await getSessionTokenFromCookie());
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return NextResponse.json(parseApiError(body, "Unable to delete workspace."), { status: response.status });
    }
    const body = await response.json();
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."), { status: 503 });
  }
}
