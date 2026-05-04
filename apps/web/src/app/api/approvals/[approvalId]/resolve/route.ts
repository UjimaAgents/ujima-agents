import { NextResponse } from "next/server";
import { ApprovalRequestSchema } from "@ujima/shared";
import { ApprovalResolveSchema } from "@ujima/api-schema";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  try {
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = ApprovalResolveSchema.safeParse(payload);
    const { approvalId } = await context.params;

    if (!parsed.success || !approvalId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid approval resolve request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      `/api/approvals/${approvalId}/resolve`,
      {
        method: "POST",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to resolve approval right now."),
        { status: response.status },
      );
    }

    const approval = ApprovalRequestSchema.safeParse(body);
    if (!approval.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected approval response from the Ujima daemon."),
        { status: 502 },
      );
    }

    return NextResponse.json(approval.data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error
          ? error.message
          : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
