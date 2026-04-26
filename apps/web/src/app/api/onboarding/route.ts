import type { OnboardingRequest } from "@ujima/api-schema";
import { NextResponse } from "next/server";
import { fetchUjimaApi } from "@/lib/ujima-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as OnboardingRequest;
    const response = await fetchUjimaApi("/api/onboarding", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "ERR_UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to submit onboarding to the Ujima API.",
      },
      { status: 503 },
    );
  }
}
