import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const runId = params.get("runId");
  const threadId = params.get("threadId");
  if (!runId && !threadId) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "runId or threadId is required." },
      { status: 400 },
    );
  }
  try {
    const upstreamParams = new URLSearchParams();
    if (runId) upstreamParams.set("runId", runId);
    if (threadId) upstreamParams.set("threadId", threadId);
    const response = await daemonFetch(
      `/api/questions?${upstreamParams.toString()}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to list questions."),
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
