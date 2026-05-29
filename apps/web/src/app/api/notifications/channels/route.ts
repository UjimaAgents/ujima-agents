import { NextResponse } from "next/server";
import { upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await daemonFetch("/api/notifications/channels", {}, await getSessionTokenFromCookie());
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    return NextResponse.json(upstreamUnavailable(error instanceof Error ? error.message : ""), { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const res = await daemonFetch("/api/notifications/channels", { method: "POST", body: JSON.stringify(payload) }, await getSessionTokenFromCookie());
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    return NextResponse.json(upstreamUnavailable(error instanceof Error ? error.message : ""), { status: 503 });
  }
}
