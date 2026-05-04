import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ providerName: string }> }) {
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

    const response = await daemonFetch(
      `/api/settings/providers/${encodeURIComponent(providerName)}/test?organizationId=${encodeURIComponent(organizationId)}`,
      { method: "POST" },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to test provider."),
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
