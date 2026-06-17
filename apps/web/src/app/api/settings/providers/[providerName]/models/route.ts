import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ providerName: string }> }) {
  try {
    const { providerName } = await params;
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
      `/api/settings/providers/${encodeURIComponent(providerName)}/models?organizationId=${encodeURIComponent(organizationId)}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to discover models."),
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
