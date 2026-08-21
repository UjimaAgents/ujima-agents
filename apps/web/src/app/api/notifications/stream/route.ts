import { NextResponse } from "next/server";
import { SocketEventNames, type SocketEventName } from "@ujima/shared";
import {
  getSessionTokenFromCookie,
  getServerAuthState,
} from "@/server/ujima-daemon";
import { createSocketEventStream } from "@/server/socket-event-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionToken = await getSessionTokenFromCookie();
  if (!sessionToken) {
    return NextResponse.json(
      { code: "ERR_UNAUTHORIZED", message: "Sign in before opening notifications." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  if (!organizationId) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Invalid notifications request." },
      { status: 400 },
    );
  }

  try {
    const authState = await getServerAuthState();
    if (!authState.authenticated || authState.user?.organizationId !== organizationId) {
      return NextResponse.json(
        { code: "ERR_FORBIDDEN", message: "Unauthorized for this organization." },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { code: "ERR_UNAUTHORIZED", message: "Sign in before opening notifications." },
      { status: 401 },
    );
  }

  return createSocketEventStream(request, {
    subscription: {
      organizationId,
      channelIds: [],
      threadIds: [],
      memberIds: [],
      runIds: [],
    },
    events: WORKSPACE_EVENTS,
  });
}

const WORKSPACE_EVENTS = [
  SocketEventNames.channelMessage,
  SocketEventNames.threadMessage,
  SocketEventNames.dmMessage,
  SocketEventNames.approvalRequested,
  SocketEventNames.approvalResolved,
  SocketEventNames.runStarted,
  SocketEventNames.runUpdated,
  SocketEventNames.runCompleted,
  SocketEventNames.workflowRunUpdated,
] satisfies readonly SocketEventName[];
