import type { OnboardingRequest } from "@ujima/api-schema";
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
    const payload = (await request.json().catch(() => null)) as Partial<OnboardingRequest> | null;
    if (
      !payload ||
      typeof payload.organizationName !== "string" ||
      typeof payload.ownerName !== "string" ||
      typeof payload.ownerEmail !== "string" ||
      typeof payload.ownerPassword !== "string" ||
      payload.ownerPassword.length < 8 ||
      typeof payload.workspaceRoot !== "string" ||
      typeof payload.providerKeys !== "object" ||
      payload.providerKeys === null ||
      typeof payload.team !== "object" ||
      payload.team === null
    ) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid onboarding request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch("/api/onboarding", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to complete onboarding right now."),
        { status: response.status },
      );
    }

    if (
      !hasSessionToken(body) ||
      !hasObjectProperty(body, "auth") ||
      !hasObjectProperty(body.auth, "session") ||
      !hasObjectProperty(body.auth.session, "expiresAt") ||
      typeof body.auth.session.expiresAt !== "string" ||
      !hasObjectProperty(body, "organization")
    ) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected onboarding response from the Ujima daemon."),
        { status: 502 },
      );
    }

    const nextResponse = NextResponse.json(stripSessionToken(body), { status: response.status });
    setSessionCookie(nextResponse, body.sessionToken, body.auth.session.expiresAt);
    return nextResponse;
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to submit onboarding to the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
