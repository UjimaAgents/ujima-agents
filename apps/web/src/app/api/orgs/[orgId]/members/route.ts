import { NextResponse } from "next/server";
import { MemberSchema } from "@ujima/shared";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AddMemberRequestSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(["human", "agent"]),
  roleName: z.string().min(1),
  channelIds: z.array(z.string().min(1)).default([]),
  llm: z.string().optional(),
  model: z.string().optional(),
  role: z
    .object({
      id: z.string().min(1).optional(),
      name: z.string().min(1),
      title: z.string().min(1),
      description: z.string().default(""),
      instructions: z.string().min(1),
      kind: z.enum(["human", "agent"]).default("agent"),
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      workspaceScopes: z.array(z.string().min(1)).default([]),
      tools: z.array(z.string().min(1)).default([]),
      channels: z.array(z.string().min(1)).default(["general"]),
      skills: z.array(z.string().min(1)).default([]),
    })
    .optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ orgId: string }> }) {
  try {
    const { orgId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = AddMemberRequestSchema.safeParse(payload);
    if (!parsed.success || typeof orgId !== "string" || orgId.length === 0) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid member request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(orgId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/members`,
      {
        method: "POST",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to create member right now."),
        { status: response.status },
      );
    }

    const member = MemberSchema.safeParse(body);
    if (!member.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected member response from the Ujima daemon."),
        { status: 502 },
      );
    }

    return NextResponse.json(member.data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
