import { NextResponse } from "next/server";
import { io } from "socket.io-client";
import {
  SocketEventNames,
  SocketEventSchemas,
  type SocketEventName,
} from "@ujima/shared";
import {
  daemonBaseUrl,
  daemonFetch,
  getSessionTokenFromCookie,
  readDaemonBearerToken,
  getServerAuthState,
} from "@/server/ujima-daemon";

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

    // Verify access to the requested thread
    const params = new URLSearchParams({ organizationId });
    const verifyResponse = await daemonFetch(
      `/api/threads/${encodeURIComponent(threadId)}/verify?${params.toString()}`,
      {},
      sessionToken,
    );
    if (!verifyResponse.ok) {
      return NextResponse.json(
        { code: "ERR_FORBIDDEN", message: "Unauthorized for this thread." },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { code: "ERR_UNAUTHORIZED", message: "Sign in before opening conversation streams." },
      { status: 401 },
    );
  }

  const channelIds = [threadId];
  const memberIds = resolveTrustedMemberIds(threadId, authenticatedMemberId);

  const encoder = new TextEncoder();
  let socket: ReturnType<typeof io> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (envelope: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      socket = io(daemonBaseUrl(), {
        path: "/events",
        transports: ["websocket"],
        auth: { token: readDaemonBearerToken() },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      });

      socket.on("connect", () => {
        socket?.emit("subscribe", {
          organizationId,
          channelIds,
          threadIds: [threadId],
          memberIds,
          runIds: [],
        });
        send({ type: "ready" });
      });

      for (const eventName of Object.values(SocketEventNames) as SocketEventName[]) {
        socket.on(eventName, (payload: unknown) => {
          const schema = SocketEventSchemas[eventName];
          const parsed = schema.safeParse(payload);
          if (!parsed.success) return;
          if (!shouldForwardEvent(eventName, parsed.data, { threadId, channelIds, memberIds })) {
            return;
          }
          send({ type: "socket", event: eventName, payload: parsed.data });
        });
      }

      socket.on("connect_error", (error) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      });

      socket.on("disconnect", () => {
        // Keep the SSE bridge open so the socket can reconnect without the
        // browser losing the conversation stream.
      });

      request.signal.addEventListener("abort", () => {
        socket?.disconnect();
        close();
      });
    },
    cancel() {
      socket?.disconnect();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
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
  const threadIds = new Set([input.threadId]);

  switch (eventName) {
    case SocketEventNames.channelMessage: {
      const body = payload as { channelId?: string };
      return typeof body.channelId === "string" && input.channelIds.includes(body.channelId);
    }
    case SocketEventNames.channelPresence: {
      const body = payload as { channelId?: string };
      return typeof body.channelId === "string" && input.channelIds.includes(body.channelId);
    }
    case SocketEventNames.threadMessage: {
      const body = payload as { threadId?: string };
      return typeof body.threadId === "string" && threadIds.has(body.threadId);
    }
    case SocketEventNames.dmMessage: {
      const body = payload as { message?: { threadId?: string } };
      return typeof body.message?.threadId === "string" && threadIds.has(body.message.threadId);
    }
    case SocketEventNames.approvalRequested:
    case SocketEventNames.approvalResolved: {
      const body = payload as { threadId?: string };
      return typeof body.threadId === "string" && threadIds.has(body.threadId);
    }
    case SocketEventNames.runStarted:
    case SocketEventNames.runUpdated:
    case SocketEventNames.runCompleted: {
      const body = payload as { run?: { threadId?: string } };
      return typeof body.run?.threadId === "string" && threadIds.has(body.run.threadId);
    }
    case SocketEventNames.toolCalled:
    case SocketEventNames.toolResult: {
      const body = payload as { threadId?: string };
      return typeof body.threadId === "string" && threadIds.has(body.threadId);
    }
    case SocketEventNames.memberAlerted: {
      const body = payload as { threadId?: string };
      return typeof body.threadId === "string" && threadIds.has(body.threadId);
    }
    case SocketEventNames.memberAlertFailed: {
      const body = payload as { threadId?: string };
      return typeof body.threadId === "string" && threadIds.has(body.threadId);
    }
    case SocketEventNames.memberUpdated: {
      const body = payload as { member?: { id?: string } };
      if (typeof body.member?.id !== "string") return false;
      return input.memberIds.includes(body.member.id);
    }
    case SocketEventNames.supervisorReplied: {
      const body = payload as { message?: { threadId?: string } };
      return typeof body.message?.threadId === "string" && threadIds.has(body.message.threadId);
    }
    default:
      return false;
  }
}

function resolveTrustedMemberIds(threadId: string, authenticatedMemberId: string): string[] {
  const members = new Set<string>([authenticatedMemberId]);
  if (threadId.startsWith("dm:")) {
    const [_, firstId, secondId] = threadId.split(":", 3);
    if (firstId) members.add(firstId);
    if (secondId) members.add(secondId);
  }
  return [...members];
}
