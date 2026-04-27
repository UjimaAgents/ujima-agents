import { NextResponse } from "next/server";
import { clearSessionCookie, daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export async function POST() {
  const response = await daemonFetch(
    "/api/auth/logout",
    { method: "POST" },
    await getSessionTokenFromCookie(),
  );
  const body = await response.json().catch(() => ({}));
  await clearSessionCookie();
  return NextResponse.json(body, { status: response.status });
}
