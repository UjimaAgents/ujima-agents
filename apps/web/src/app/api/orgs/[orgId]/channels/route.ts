import { NextResponse } from "next/server";
import { ChannelSchema } from "@ujima/shared";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateChannelRequestSchema = z.object({
  name: z.string().min(1),
  topic: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = CreateChannelRequestSchema.safeParse(payload);
    if (!parsed.success || typeof orgId !== "string" || orgId.length === 0) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid channel request." },
        { status: 400 },
      );
    }

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/channels`,
      {
        method: "POST",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to create channel right now."),
        { status: response.status },
      );
    }

    const channel = ChannelSchema.safeParse(body);
    if (!channel.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected channel response from the Ujima daemon."),
        { status: 502 },
      );
    }

    return NextResponse.json(channel.data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
