import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const response = await daemonFetch(`/api/schedules/${encodeURIComponent(id)}`, {}, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to get scheduled job."),
        { status: response.status },
      );
    }

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const payload = await request.json().catch(() => null);
    if (!payload) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Request body is required." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(`/api/schedules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, await getSessionTokenFromCookie());
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to update scheduled job."),
        { status: response.status },
      );
    }

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const response = await daemonFetch(`/api/schedules/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }, await getSessionTokenFromCookie());

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return NextResponse.json(
        parseApiError(body, "Unable to delete scheduled job."),
        { status: response.status },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(error instanceof Error ? error.message : "Unable to reach the daemon."),
      { status: 503 },
    );
  }
}
