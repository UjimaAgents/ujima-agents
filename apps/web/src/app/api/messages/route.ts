import { NextResponse } from "next/server";
import { MessageSchema } from "@ujima/shared";
import { MessageCreateSchema } from "@ujima/api-schema";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = MessageCreateSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid message request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(parsed.data.organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      "/api/messages",
      {
        method: "POST",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to send message right now."),
        { status: response.status },
      );
    }

    const message = MessageSchema.safeParse(body);
    if (!message.success) {
      return NextResponse.json(
        upstreamUnavailable(
          "Unexpected message response from the Ujima daemon.",
        ),
        { status: 502 },
      );
    }

    return NextResponse.json(message.data, { status: response.status });
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
