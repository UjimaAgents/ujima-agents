import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ orgId: string; channelId: string }> }) {
  try {
    const { orgId, channelId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid channel update request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(orgId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(channelId)}`,
      { method: "PATCH", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to update channel right now."),
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

export async function DELETE(_request: Request, { params }: { params: Promise<{ orgId: string; channelId: string }> }) {
  try {
    const { orgId, channelId } = await params;

    const forbidden = await requireProxyOrgAccess(orgId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/channels/${encodeURIComponent(channelId)}`,
      { method: "DELETE" },
      await getSessionTokenFromCookie(),
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return NextResponse.json(
        parseApiError(body, "Unable to delete channel right now."),
        { status: response.status },
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
