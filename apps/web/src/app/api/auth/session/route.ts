import { NextResponse } from "next/server";
import { hasObjectProperty, parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await daemonFetch(
      "/api/auth/session",
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to resolve the current session from the Ujima daemon."),
        { status: response.status },
      );
    }

    if (
      !hasObjectProperty(body, "authenticated") ||
      typeof body.authenticated !== "boolean" ||
      !hasObjectProperty(body, "user") ||
      !hasObjectProperty(body, "member") ||
      !hasObjectProperty(body, "session")
    ) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected session response from the Ujima daemon."),
        { status: 502 },
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
