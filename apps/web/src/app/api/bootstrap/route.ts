import { NextResponse } from "next/server";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export async function GET() {
  const response = await daemonFetch("/api/bootstrap", {}, await getSessionTokenFromCookie());
  const body = await response.json().catch(() => ({}));
  return NextResponse.json(body, { status: response.status });
}
