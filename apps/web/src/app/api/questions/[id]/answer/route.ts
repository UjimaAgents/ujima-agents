import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload.selectedOption !== "string") {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "selectedOption is required." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      `/api/questions/${encodeURIComponent(id)}/answer`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to answer question."),
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
