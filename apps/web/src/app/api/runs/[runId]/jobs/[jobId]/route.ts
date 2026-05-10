import { NextResponse } from "next/server";
import { ShellJobDetailSchema } from "@ujima/api-schema";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string; jobId: string }> },
) {
  try {
    const { runId, jobId } = await context.params;
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!runId || !jobId || !organizationId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Missing run, job, or organization." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const qs = new URLSearchParams({ organizationId });
    const response = await daemonFetch(
      `/api/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}?${qs.toString()}`,
      { method: "GET" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to load background job output."),
        { status: response.status },
      );
    }

    const parsed = ShellJobDetailSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected background job response from the Ujima daemon."),
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
