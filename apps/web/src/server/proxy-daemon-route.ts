import { NextResponse } from "next/server";
import { parseApiError, upstreamUnavailable } from "@/server/api-response";
import { requireProxyOrgAccess } from "@/server/route-guards";
import { daemonFetch, getSessionTokenFromCookie } from "@/server/ujima-daemon";

export function organizationIdFromQuery(request: Request): string | null {
  return new URL(request.url).searchParams.get("organizationId");
}

export async function organizationIdFromJsonBody(
  request: Request,
): Promise<{ organizationId: string; payload: unknown } | NextResponse> {
  const payload = (await request.json().catch(() => null)) as unknown;
  if (
    !payload ||
    typeof payload !== "object" ||
    typeof (payload as Record<string, unknown>).organizationId !== "string"
  ) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Invalid request." },
      { status: 400 },
    );
  }
  return {
    organizationId: (payload as Record<string, string>).organizationId,
    payload,
  };
}

export async function proxyDaemonRoute(
  organizationId: string,
  path: string,
  init: RequestInit = {},
  fallbackMessage: string,
  options?: {
    forwardStructuredError?: (body: unknown) => boolean;
  },
): Promise<NextResponse> {
  try {
    const forbidden = await requireProxyOrgAccess(organizationId);
    if (forbidden) return forbidden;

    const response = await daemonFetch(path, init, await getSessionTokenFromCookie());
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (options?.forwardStructuredError?.(body)) {
        return NextResponse.json(body, { status: response.status });
      }
      return NextResponse.json(parseApiError(body, fallbackMessage), { status: response.status });
    }

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to reach the Ujima daemon.",
      ),
      { status: 503 },
    );
  }
}

export function missingOrganizationIdResponse(): NextResponse {
  return NextResponse.json(
    { code: "ERR_BAD_REQUEST", message: "organizationId is required." },
    { status: 400 },
  );
}

export function isTestMcpResponse(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === "object" &&
    "ok" in body &&
    "tools" in body &&
    "testedAt" in body
  );
}
