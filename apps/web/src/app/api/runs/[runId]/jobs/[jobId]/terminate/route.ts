import { NextResponse } from "next/server";
import { RunJobTerminateSchema } from "@ujima/api-schema";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string; jobId: string }> },
) {
  try {
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = RunJobTerminateSchema.safeParse(payload);
    const { runId, jobId } = await context.params;

    if (!parsed.success || !runId || !jobId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid terminate job request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(parsed.data.organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}/terminate`,
      {
        method: "POST",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to terminate the background job."),
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
