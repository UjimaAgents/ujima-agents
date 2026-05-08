import { NextResponse } from "next/server";
import { io } from "socket.io-client";
import { SocketEventNames, SocketEventSchemas, type SocketEventName } from "@ujima/shared";
import {
  daemonBaseUrl,
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
          channelIds: [],
          threadIds: [],
          memberIds: [],
          runIds: [],
        });
        send({ type: "ready" });
      });

      for (const eventName of Object.values(SocketEventNames) as SocketEventName[]) {
        socket.on(eventName, (payload: unknown) => {
          const schema = SocketEventSchemas[eventName];
          const parsed = schema.safeParse(payload);
          if (!parsed.success) return;
          if (!shouldForwardWorkspaceEvent(eventName)) return;
          send({ type: "socket", event: eventName, payload: parsed.data });
        });
      }

      socket.on("connect_error", (error) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      });

      socket.on("disconnect", () => {
        // Keep the SSE bridge open so websocket reconnects stay invisible.
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

function shouldForwardWorkspaceEvent(eventName: SocketEventName): boolean {
  switch (eventName) {
    case SocketEventNames.channelMessage:
    case SocketEventNames.threadMessage:
    case SocketEventNames.dmMessage:
    case SocketEventNames.approvalRequested:
    case SocketEventNames.approvalResolved:
    case SocketEventNames.runStarted:
    case SocketEventNames.runUpdated:
    case SocketEventNames.runCompleted:
      return true;
    default:
      return false;
  }
}
