import { NextResponse } from "next/server";
import { MessageSchema } from "@ujima/shared";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get("organizationId");
    const threadId = url.searchParams.get("threadId");
    const limit = url.searchParams.get("limit") ?? "100";
    const cursor = url.searchParams.get("cursor");
    if (!organizationId || !threadId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid conversation history request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const params = new URLSearchParams({ organizationId, limit });
    if (cursor) params.set("cursor", cursor);

    const response = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/messages?${params.toString()}`,
      {},
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (response.status === 404) {
      return NextResponse.json({ data: [], hasMore: false, nextCursor: undefined }, { status: 200 });
    }

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to load conversation history right now."),
        { status: response.status },
      );
    }

    if (!body || !Array.isArray(body.data)) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected conversation history response from the Ujima daemon."),
        { status: 502 },
      );
    }

    const messages = body.data.flatMap((item: unknown) => {
      const parsed = MessageSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });

    return NextResponse.json(
      {
        data: messages,
        hasMore: Boolean(body.hasMore),
        nextCursor: typeof body.nextCursor === "string" ? body.nextCursor : undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
