import { NextResponse } from "next/server";
import { upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const payload = await request.json();
    const res = await daemonFetch(`/api/notifications/channels/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, await getSessionTokenFromCookie());
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (error) {
    return NextResponse.json(upstreamUnavailable(error instanceof Error ? error.message : ""), { status: 503 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await daemonFetch(`/api/notifications/channels/${id}`, { method: "DELETE" }, await getSessionTokenFromCookie());
    return new NextResponse(null, { status: res.status });
  } catch (error) {
    return NextResponse.json(upstreamUnavailable(error instanceof Error ? error.message : ""), { status: 503 });
  }
}
