import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

/** Proxies background job IDs for a run (daemon-side shell registry). Requires organization scope. */
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await context.params;
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!runId || !organizationId) {
      return NextResponse.json(
        {
          code: "ERR_BAD_REQUEST",
          message: "Missing run id or organizationId.",
        },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const qs = new URLSearchParams({ organizationId });
    const response = await daemonFetch(
      `/api/runs/${encodeURIComponent(runId)}/jobs?${qs.toString()}`,
      { method: "GET" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to list background jobs."),
        { status: response.status },
      );
    }

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
