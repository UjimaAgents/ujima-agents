import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid policies request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/policies`,
      { method: "PATCH", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to update policies right now."),
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
