import { NextResponse } from "next/server";
import { MemberSchema, MemberShellApprovalModeSchema } from "@ujima/shared";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PatchMemberPreferencesSchema = z.object({
  shellApprovalMode: MemberShellApprovalModeSchema.optional(),
  llm: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgId: string; memberId: string }> },
) {
  try {
    const { orgId, memberId } = await params;
    const payload = (await request.json().catch(() => null)) as unknown;
    const parsed = PatchMemberPreferencesSchema.safeParse(payload);
    if (!parsed.success || !orgId || !memberId) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid member preferences request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(orgId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}/preferences`,
      {
        method: "PATCH",
        body: JSON.stringify(parsed.data),
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to update member preferences right now."),
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
