import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    const path =
      q && q.trim().length > 0
        ? `/api/workspaces/search?q=${encodeURIComponent(q)}`
        : "/api/workspaces/search";
    const response = await daemonFetch(path, {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to search workspace files."), {
        status: response.status,
      });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}