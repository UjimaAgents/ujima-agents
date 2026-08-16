import { NextResponse } from "next/server";
import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const channelId = new URL(request.url).searchParams.get("channelId");
  const path = channelId ? `/api/workflows?channelId=${encodeURIComponent(channelId)}` : "/api/workflows";
  return proxyDaemonHttpRoute(path, {}, "Unable to list workflows.");
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json({ code: "ERR_BAD_REQUEST", message: "Request body is required." }, { status: 400 });
    }
    return proxyDaemonHttpRoute(
      "/api/workflows",
      { method: "POST", body: JSON.stringify(payload) },
      "Unable to create workflow.",
    );
  } catch (error) {
    return NextResponse.json({ code: "ERR_BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }
}
