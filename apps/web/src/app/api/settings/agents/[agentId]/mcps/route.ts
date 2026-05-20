import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
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
      `/api/settings/agents/${encodeURIComponent(agentId)}/mcps?organizationId=${encodeURIComponent(organizationId)}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to fetch agent MCP attachments."),
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

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== "object" || typeof (payload as Record<string, unknown>).organizationId !== "string") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid request." },
        { status: 400 },
      );
    }

    const organizationId = (payload as Record<string, string>).organizationId;
    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/settings/agents/${encodeURIComponent(agentId)}/mcps`,
      { method: "POST", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to attach MCP server."),
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
