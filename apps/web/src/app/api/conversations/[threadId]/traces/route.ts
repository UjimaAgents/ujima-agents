import { NextResponse } from "next/server";
import { RunTraceListResponseSchema } from "@ujima/api-schema";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  try {
    const { threadId } = await context.params;
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!threadId || !organizationId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid trace history request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const params = new URLSearchParams({ organizationId });
    const cursor = url.searchParams.get("cursor");
    const limit = url.searchParams.get("limit");
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", limit);

    const response = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/traces?${params.toString()}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to load reasoning traces right now."),
        { status: response.status },
      );
    }

    const parsed = RunTraceListResponseSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected trace history response from the Ujima daemon."),
        { status: 502 },
      );
    }

    return NextResponse.json(parsed.data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
