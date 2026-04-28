import type { AuthLoginRequest } from "@ujima/api-schema";
import { NextResponse } from "next/server";
import {
  hasObjectProperty,
  hasSessionToken,
  parseApiError,
  stripSessionToken,
  upstreamUnavailable,
} from "@/server/api-response";
import { daemonFetch, setSessionCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as Partial<AuthLoginRequest> | null;
    if (
      !payload ||
      typeof payload.email !== "string" ||
      typeof payload.password !== "string" ||
      payload.password.length < 8 ||
      (payload.organizationId !== undefined && typeof payload.organizationId !== "string")
    ) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid login request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to sign in right now."),
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
        upstreamUnavailable("Unexpected login response from the Ujima daemon."),
        { status: 502 },
      );
    }

    await setSessionCookie(body.sessionToken, body.auth.session.expiresAt);

    return NextResponse.json(stripSessionToken(body), { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
