import { NextResponse } from "next/server";
import {
  parseDmThreadId,
  SocketEventNames,
  type SocketEventName,
} from "@ujima/shared";
import {
  daemonFetch,
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
      { code: "ERR_UNAUTHORIZED", message: "Sign in before opening conversation streams." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId");
  const threadId = url.searchParams.get("threadId");

  if (!organizationId || !threadId) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Invalid conversation stream request." },
      { status: 400 },
    );
  }

  let authenticatedMemberId: string | undefined;
  let verifiedChannelIds: string[] = [];
  let verifiedMemberIds: string[] = [];
  try {
    const authState = await getServerAuthState();
    if (!authState.authenticated || authState.user?.organizationId !== organizationId) {
      return NextResponse.json(
        { code: "ERR_FORBIDDEN", message: "Unauthorized for this organization." },
        { status: 403 },
      );
    }
    authenticatedMemberId = authState.member?.id;
    if (!authenticatedMemberId) {
      return NextResponse.json(
        { code: "ERR_UNAUTHORIZED", message: "Sign in before opening conversation streams." },
        { status: 401 },
      );
    }

    // Verify access to the requested thread and use the daemon-derived
    // membership for event visibility rather than caller-controlled params.
    const params = new URLSearchParams({ organizationId });
    const verifyResponse = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/verify?${params.toString()}`,
      {},
      sessionToken,
    );
    const verifyBody = await verifyResponse.json().catch(() => null);
    if (!verifyResponse.ok) {
      return NextResponse.json(
        { code: "ERR_FORBIDDEN", message: "Unauthorized for this thread." },
        { status: 403 },
      );
    }
    const verified = parseVerifiedThreadAccess(verifyBody);
    if (verified) {
      verifiedChannelIds = verified.channelIds;
      verifiedMemberIds = verified.memberIds;
    }
  } catch {
    return NextResponse.json(
      { code: "ERR_UNAUTHORIZED", message: "Sign in before opening conversation streams." },
      { status: 401 },
    );
  }

  const channelIds = verifiedChannelIds.length ? verifiedChannelIds : [threadId];
  const memberIds = verifiedMemberIds.length
    ? verifiedMemberIds
    : resolveTrustedMemberIds(threadId, authenticatedMemberId);

  return createSocketEventStream(request, {
    subscription: {
      organizationId,
      channelIds,
      threadIds: [threadId],
      memberIds,
      runIds: [],
    },
    shouldForward: (eventName, payload) =>
      shouldForwardEvent(eventName, payload, { threadId, channelIds, memberIds }),
  });
}

function shouldForwardEvent(
  eventName: SocketEventName,
  payload: unknown,
  input: {
    threadId: string;
    channelIds: string[];
    memberIds: string[];
  },
): boolean {
  switch (eventName) {
    case SocketEventNames.channelMessage:
    case SocketEventNames.channelPresence: {
      const body = payload as { channelId?: string };
      return typeof body.channelId === "string" && input.channelIds.includes(body.channelId);
    }
    case SocketEventNames.threadMessage: {
      const body = payload as { threadId?: string };
      return body.threadId === input.threadId;
    }
    case SocketEventNames.dmMessage: {
      const body = payload as { message?: { threadId?: string } };
      return body.message?.threadId === input.threadId;
    }
    case SocketEventNames.approvalRequested:
    case SocketEventNames.approvalResolved:
    case SocketEventNames.runChunk:
    case SocketEventNames.runTokens:
    case SocketEventNames.toolCalled:
    case SocketEventNames.toolResult:
    case SocketEventNames.memberAlerted:
    case SocketEventNames.memberAlertFailed:
    case SocketEventNames.memberMustReplyFailed: {
      const body = payload as { threadId?: string };
      return body.threadId === input.threadId;
    }
    case SocketEventNames.runStarted:
    case SocketEventNames.runUpdated:
    case SocketEventNames.runCompleted: {
      const body = payload as { run?: { threadId?: string } };
      return body.run?.threadId === input.threadId;
    }
    case SocketEventNames.agentPassed:
    case SocketEventNames.agentPassedWithText:
    case SocketEventNames.agentAck:
    case SocketEventNames.agentHandoff:
    case SocketEventNames.decisionVerification:
    case SocketEventNames.wakeSuppressed:
    case SocketEventNames.runSilentCompletion:
    case SocketEventNames.runEmptyCompletion:
    case SocketEventNames.mirrorSuppressed:
    case SocketEventNames.echoSuppressed:
    case SocketEventNames.supervisorReplied: {
      const body = payload as {
        threadId?: string;
        channelId?: string;
        message?: { threadId?: string; channelId?: string };
      };
      const threadId = body.threadId ?? body.message?.threadId;
      const channelId = body.channelId ?? body.message?.channelId;
      return (
        threadId === input.threadId ||
        (typeof channelId === "string" && input.channelIds.includes(channelId))
      );
    }
    case SocketEventNames.memberUpdated: {
      const body = payload as { member?: { id?: string } };
      return typeof body.member?.id === "string" && input.memberIds.includes(body.member.id);
    }
    default:
      return false;
  }
}

function parseVerifiedThreadAccess(value: unknown): { memberIds: string[]; channelIds: string[] } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    memberIds: Array.isArray(record.memberIds) ? record.memberIds.filter((id): id is string => typeof id === "string") : [],
    channelIds: Array.isArray(record.channelIds) ? record.channelIds.filter((id): id is string => typeof id === "string") : [],
  };
}

function resolveTrustedMemberIds(threadId: string, authenticatedMemberId: string): string[] {
  const members = new Set<string>([authenticatedMemberId]);
  const dm = parseDmThreadId(threadId);
  if (dm) {
    members.add(dm.participantA);
    members.add(dm.participantB);
  }
  return [...members];
}
