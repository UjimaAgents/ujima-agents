import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const { threadId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("organizationId" in payload) ||
      !("mode" in payload) ||
      typeof (payload as { organizationId?: unknown }).organizationId !== "string" ||
      !["summarize", "clear"].includes((payload as { mode?: unknown }).mode as string)
    ) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid conversation archive request." },
        { status: 400 },
      );
    }

    const { organizationId, mode } = payload as { organizationId: string; mode: "summarize" | "clear" };
    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/archive`,
      {
        method: "POST",
        body: JSON.stringify({ organizationId, mode }),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to archive conversation right now."),
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
