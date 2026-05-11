import { NextResponse } from "next/server";
import { parseApiError } from "@/server/api-response";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";
import { requireProxyOrgAccess } from "@/server/route-guards";

export async function proxyAttachment(
  request: Request,
  attachmentId: string,
  thumbnail = false,
): Promise<Response> {
  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Invalid attachment request." },
      { status: 400 },
    );
  }

  const forbidden = await requireProxyOrgAccess(organizationId);
  if (forbidden) return forbidden;

  const response = await daemonFetch(
    `/api/attachments/${encodeURIComponent(attachmentId)}${thumbnail ? "/thumbnail" : ""}?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    await getSessionTokenFromCookie(),
  );

  if (response.status === 204) {
    return new Response(null, { status: 204 });
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return NextResponse.json(
      parseApiError(body, "Unable to load attachment right now."),
      { status: response.status },
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
