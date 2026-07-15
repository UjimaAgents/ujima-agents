import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const channelId = new URL(request.url).searchParams.get("channelId");
    const path = channelId ? `/api/workflows?channelId=${encodeURIComponent(channelId)}` : "/api/workflows";
    const response = await daemonFetch(path, {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to list workflows."), { status: response.status });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json({ code: "ERR_BAD_REQUEST", message: "Request body is required." }, { status: 400 });
    }
    const response = await daemonFetch(
      "/api/workflows",
      { method: "POST", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to create workflow."), { status: response.status });
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}
