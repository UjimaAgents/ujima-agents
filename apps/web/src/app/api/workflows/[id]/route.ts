import { NextResponse } from "next/server";
import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyDaemonHttpRoute(`/api/workflows/${encodeURIComponent(id)}`, {}, "Unable to load workflow.");
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json({ code: "ERR_BAD_REQUEST", message: "Request body is required." }, { status: 400 });
    }
    return proxyDaemonHttpRoute(
      `/api/workflows/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(payload) },
      "Unable to save workflow.",
    );
  } catch (error) {
    return NextResponse.json({ code: "ERR_BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid request." }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyDaemonHttpRoute(`/api/workflows/${encodeURIComponent(id)}`, { method: "DELETE" }, "Unable to delete workflow.");
}
