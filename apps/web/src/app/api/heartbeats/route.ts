import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await daemonFetch("/api/heartbeats", {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to list heartbeats."), {
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

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (
      !payload ||
      typeof payload.name !== "string" ||
      typeof payload.cronExpression !== "string" ||
      typeof payload.prompt !== "string"
    ) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "name, cronExpression, and prompt are required." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(parseApiError(body, "Unable to create heartbeat."), {
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
