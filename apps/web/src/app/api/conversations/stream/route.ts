import { NextResponse } from "next/server";
import { io } from "socket.io-client";
import {
  SocketEventNames,
  SocketEventSchemas,
  type SocketEventName,
} from "@ujima/shared";
import { upstreamUnavailable } from "@/server/api-response";
import {
  daemonBaseUrl,
  getSessionTokenFromCookie,
  readDaemonBearerToken,
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
  const memberIds = url.searchParams.getAll("memberIds").filter(Boolean);

  if (!organizationId || !threadId) {
    return NextResponse.json(
      { code: "ERR_BAD_REQUEST", message: "Invalid conversation stream request." },
      { status: 400 },
    );
  }

  const encoder = new TextEncoder();
  let socket: ReturnType<typeof io> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (envelope: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
      };

      socket = io(daemonBaseUrl(), {
        path: "/events",
        transports: ["websocket"],
        auth: { token: readDaemonBearerToken() },
        reconnection: false,
      });

      socket.on("connect", () => {
        socket?.emit("subscribe", {
          organizationId,
          channelIds: [],
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
          send({ type: "socket", event: eventName, payload: parsed.data });
        });
      }

      socket.on("connect_error", (error) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        controller.close();
      });

      socket.on("disconnect", () => {
        controller.close();
      });

      request.signal.addEventListener("abort", () => {
        socket?.disconnect();
        controller.close();
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
