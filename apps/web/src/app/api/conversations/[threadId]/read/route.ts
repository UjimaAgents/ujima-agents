import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await params;
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Missing organization id." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/read?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "POST" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);
    if (response.status === 404) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to mark conversation as read."),
        { status: response.status },
      );
    }
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the Ujima daemon."),
      { status: 503 },
    );
  }
}
