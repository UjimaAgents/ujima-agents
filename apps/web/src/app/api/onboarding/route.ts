import type { OnboardingRequest } from "@ujima/api-schema";
import { NextResponse } from "next/server";
import { daemonFetch, setSessionCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OnboardingRequest;
    const response = await daemonFetch("/api/onboarding", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({})) as {
      auth?: { session?: { expiresAt?: string } };
      sessionToken?: string;
    };

    if (!response.ok) {
      return NextResponse.json(body, { status: response.status });
    }

    if (body.sessionToken && body.auth?.session?.expiresAt) {
      await setSessionCookie(body.sessionToken, body.auth.session.expiresAt);
    }

    const sanitized = { ...body };
    delete sanitized.sessionToken;
    return NextResponse.json(sanitized, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "ERR_UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to submit onboarding to the Ujima daemon.",
      },
      { status: 503 },
    );
  }
}
