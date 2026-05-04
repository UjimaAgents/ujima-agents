import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    if (!organizationId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "organizationId is required." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      `/api/settings/organization?organizationId=${encodeURIComponent(organizationId)}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to fetch organization settings."),
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

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as unknown;
    if (!payload || typeof payload !== "object") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      "/api/settings/organization",
      { method: "PATCH", body: JSON.stringify(payload) },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to update organization settings."),
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
