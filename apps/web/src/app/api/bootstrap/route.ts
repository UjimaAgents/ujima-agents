import { NextResponse } from "next/server";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await daemonFetch("/api/bootstrap", {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      {
        code: "ERR_UPSTREAM_UNAVAILABLE",
        message: error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      },
      { status: 503 },
    );
  }
}
