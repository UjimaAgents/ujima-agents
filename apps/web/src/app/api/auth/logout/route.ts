import { NextResponse } from "next/server";
import { hasObjectProperty, parseApiError, upstreamUnavailable } from "@/server/api-response";
import { clearSessionCookie, daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST() {
  const sessionToken = await getSessionTokenFromCookie();

  try {
    const response = await daemonFetch(
      "/api/auth/logout",
      { method: "POST" },
      sessionToken,
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to log out right now."),
        { status: response.status },
      );
    }

    if (!hasObjectProperty(body, "loggedOut") || typeof body.loggedOut !== "boolean") {
      return NextResponse.json(
        upstreamUnavailable("Unexpected logout response from the Ujima daemon."),
        { status: 502 },
      );
    }

    const nextResponse = NextResponse.json(body, { status: response.status });
    clearSessionCookie(nextResponse);
    return nextResponse;
  } catch (error) {
    const nextResponse = NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
    clearSessionCookie(nextResponse);
    return nextResponse;
  }
}
