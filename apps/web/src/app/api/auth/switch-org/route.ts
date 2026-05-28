import type { AuthSwitchOrganizationRequest } from "@ujima/api-schema";
import { NextResponse } from "next/server";
import {
  hasObjectProperty,
  hasSessionToken,
  parseApiError,
  stripSessionToken,
  upstreamUnavailable,
} from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie, setSessionCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as Partial<AuthSwitchOrganizationRequest> | null;
    if (!payload || typeof payload.organizationId !== "string") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "organizationId is required." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      "/api/auth/switch-org",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to switch organization."),
        { status: response.status },
      );
    }

    if (
      !hasSessionToken(body) ||
      !hasObjectProperty(body, "auth") ||
      !hasObjectProperty(body.auth, "session") ||
      !hasObjectProperty(body.auth.session, "expiresAt") ||
      typeof body.auth.session.expiresAt !== "string"
    ) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected switch-org response from the Ujima daemon."),
        { status: 502 },
      );
    }

    const nextResponse = NextResponse.json(stripSessionToken(body), { status: response.status });
    setSessionCookie(nextResponse, body.sessionToken, body.auth.session.expiresAt);
    return nextResponse;
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the daemon.",
      ),
      { status: 503 },
    );
  }
}
