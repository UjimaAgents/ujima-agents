import { NextResponse } from "next/server";
import { upstreamUnavailable } from "./api-response";
import { DaemonRequestError, requireOrgAccess } from "./ujima-daemon";

export async function requireProxyOrgAccess(organizationId: string): Promise<NextResponse | undefined> {
  try {
    await requireOrgAccess(organizationId);
    return undefined;
  } catch (error) {
    if (error instanceof DaemonRequestError) {
      return NextResponse.json(
        { code: error.code, message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      upstreamUnavailable(
        error instanceof Error ? error.message : "Unable to verify organization access.",
      ),
      { status: 503 },
    );
  }
}
