import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const status = new URL(request.url).searchParams.get("status");
    const path = status ? `/api/workflow-runs?status=${encodeURIComponent(status)}` : "/api/workflow-runs";
    const response = await daemonFetch(path, {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to list workflow runs."), { status: response.status });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}
