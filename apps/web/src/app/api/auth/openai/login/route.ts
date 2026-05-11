import { NextResponse } from "next/server";
import { daemonBaseUrl } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(`${daemonBaseUrl()}/api/auth/openai/login`);
}
