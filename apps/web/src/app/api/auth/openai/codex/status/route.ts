import { NextResponse } from "next/server";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const loginId = searchParams.get("loginId");
    if (!loginId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "loginId parameter is required" },
        { status: 400 },
      );
    }

    const sessionToken = await getSessionTokenFromCookie();
    const response = await daemonFetch(`/api/auth/openai/codex/status?loginId=${encodeURIComponent(loginId)}`, {
      method: "GET",
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
