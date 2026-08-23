import { NextResponse } from "next/server";
import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxyDaemonHttpRoute("/api/heartbeats", {}, "Unable to list heartbeats.");
}

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (
      !payload ||
      typeof payload.name !== "string" ||
      typeof payload.cronExpression !== "string" ||
      typeof payload.prompt !== "string" ||
      typeof payload.channelId !== "string"
    ) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "name, cronExpression, prompt, and channelId are required." },
        { status: 400 },
      );
    }

    return proxyDaemonHttpRoute(
      "/api/heartbeats",
      { method: "POST", body: JSON.stringify(payload) },
      "Unable to create heartbeat.",
    );
  } catch {
    return NextResponse.json({ code: "ERR_BAD_REQUEST", message: "Invalid request." }, { status: 400 });
  }
}
