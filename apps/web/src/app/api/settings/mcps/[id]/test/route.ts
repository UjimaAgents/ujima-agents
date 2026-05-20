import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "organizationId is required." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/settings/mcps/${encodeURIComponent(id)}/test?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "POST" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    // The daemon now returns 502 with a full TestMcpResponse body
    // (`{ ok: false, tools: [], error, testedAt }`) when the upstream
    // MCP child fails — the structured diagnostics are useful to the UI
    // even though the status is non-2xx. Forward the body verbatim when
    // it looks like a TestMcpResponse; otherwise collapse to the
    // standard ApiError shape (e.g. 401 / 404 / 500 from the daemon).
    if (!response.ok) {
      if (
        body !== null &&
        typeof body === "object" &&
        "ok" in body &&
        "tools" in body &&
        "testedAt" in body
      ) {
        return NextResponse.json(body, { status: response.status });
      }
      return NextResponse.json(
        parseApiError(body, "Unable to test MCP server."),
        { status: response.status },
      );
    }

    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
