import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ agentId: string; mcpServerId: string }> },
) {
  try {
    const { agentId, mcpServerId } = await params;
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
      `/api/settings/agents/${encodeURIComponent(agentId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "DELETE" },
      await getSessionTokenFromCookie(),
    );

    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to detach MCP server."),
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
