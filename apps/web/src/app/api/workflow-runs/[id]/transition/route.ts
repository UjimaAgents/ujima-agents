import { NextResponse } from "next/server";
import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json({ code: "ERR_BAD_REQUEST", message: "Request body is required." }, { status: 400 });
    }
    return proxyDaemonHttpRoute(
      `/api/workflow-runs/${encodeURIComponent(id)}/transition`,
      { method: "POST", body: JSON.stringify(payload) },
      "Unable to update workflow run.",
    );
  } catch (error) {
    return NextResponse.json({ code: "ERR_BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }
}
