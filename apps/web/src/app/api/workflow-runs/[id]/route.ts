import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const response = await daemonFetch(
      `/api/workflow-runs/${encodeURIComponent(id)}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to load workflow run."), { status: response.status });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}
