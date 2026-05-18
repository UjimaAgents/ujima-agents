import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const response = await daemonFetch(
      `/api/workspaces/${encodeURIComponent(id)}/activate`,
      { method: "POST" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to switch workspace."),
        { status: response.status },
      );
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}
