import { handleWorkflowApiRequest } from "@/server/workflow-api-router";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ segment: string; rest?: string[] }>;
}

export function GET(request: Request, context: RouteContext) {
  return handleWorkflowApiRequest("GET", request, context.params);
}

export function POST(request: Request, context: RouteContext) {
  return handleWorkflowApiRequest("POST", request, context.params);
}

export function PUT(request: Request, context: RouteContext) {
  return handleWorkflowApiRequest("PUT", request, context.params);
}

export function DELETE(request: Request, context: RouteContext) {
  return handleWorkflowApiRequest("DELETE", request, context.params);
}