import { NextResponse } from "next/server";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const sessionToken = await getSessionTokenFromCookie();
    const response = await daemonFetch("/api/auth/openai/codex/start", {
      method: "POST",
    }, sessionToken);

    const body = await response.json();
    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { code: "ERR_DAEMON_UNAVAILABLE", message: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
