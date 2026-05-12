import { NextResponse } from "next/server";
import { AttachmentSchema } from "@ujima/shared";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const organizationId = String(form.get("organizationId") ?? "").trim();
    const file = form.get("file");

    if (!organizationId || !(file instanceof File)) {
      return NextResponse.json(
        { code: "ERR_BAD_REQUEST", message: "Invalid attachment upload request." },
        { status: 400 },
      );
    }

    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(
      "/api/attachments",
      {
        method: "POST",
        body: form,
      },
      await getSessionTokenFromCookie(),
    );
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return NextResponse.json(
        parseApiError(body, "Unable to upload attachment right now."),
        { status: response.status },
      );
    }

    const attachment = AttachmentSchema.safeParse(body);
    if (!attachment.success) {
      return NextResponse.json(
        upstreamUnavailable("Unexpected attachment response from the Ujima daemon."),
        { status: 502 },
      );
    }

    return NextResponse.json(attachment.data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}
