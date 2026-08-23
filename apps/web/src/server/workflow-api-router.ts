import { NextResponse } from "next/server";
import { proxyDaemonHttpRoute } from "@/server/proxy-daemon-route";
import {
  daemonTargetUrl,
  isKnownWorkflowApiPath,
  matchWorkflowApiRoute,
} from "@/server/workflow-api-table";

export interface WorkflowApiRouteParams {
  segment: string;
  rest?: string[];
}

const METHODS_REQUIRING_BODY = new Set(["POST", "PUT"]);

async function bodyRequestInit(
  request: Request,
): Promise<RequestInit | NextResponse> {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Request body is required." },
      { status: 400 },
    );
  }
  return { body: JSON.stringify(payload) };
}

/**
 * Dispatch a request that reached the workflow dynamic route
 * (apps/web/src/app/api/[segment]/[[...rest]]) through the route table to the
 * daemon. Segment params match the dynamic route's shape; the table validates
 * that the (method, segments) pair is one of the known workflow endpoints.
 */
export async function handleWorkflowApiRequest(
  method: string,
  request: Request,
  params: Promise<WorkflowApiRouteParams>,
): Promise<NextResponse> {
  const { segment, rest } = await params;
  const segments = rest?.length ? [segment, ...rest] : [segment];

  const match = matchWorkflowApiRoute(method, segments);
  if (!match) {
    if (isKnownWorkflowApiPath(segments)) {
      return NextResponse.json(
        { code: "ERR_METHOD_NOT_ALLOWED", message: `Method ${method} is not allowed here.` },
        { status: 405 },
      );
    }
    return NextResponse.json(
      { code: "ERR_NOT_FOUND", message: "Not found." },
      { status: 404 },
    );
  }

  const init = METHODS_REQUIRING_BODY.has(method) ? await bodyRequestInit(request) : { method };
  if (init instanceof NextResponse) return init;

  return proxyDaemonHttpRoute(daemonTargetUrl(match, request.url), init, match.fallbackMessage);
}