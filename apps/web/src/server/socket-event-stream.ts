import { io } from "socket.io-client";
import {
  SocketEventNames,
  SocketEventSchemas,
  type SocketEventName,
} from "@ujima/shared";
import { daemonBaseUrl, readDaemonBearerToken } from "./ujima-daemon";

interface SocketSubscription {
  organizationId: string;
  channelIds: string[];
  threadIds: string[];
  memberIds: string[];
  runIds: string[];
}

interface SocketEventStreamOptions {
  subscription: SocketSubscription;
  events?: readonly SocketEventName[];
  shouldForward?: (event: SocketEventName, payload: unknown) => boolean;
}

const ALL_SOCKET_EVENTS = Object.values(SocketEventNames) as SocketEventName[];

export function createSocketEventStream(
  request: Request,
  options: SocketEventStreamOptions,
): Response {
  const encoder = new TextEncoder();
  let socket: ReturnType<typeof io> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (envelope: unknown) => {
        if (!closed) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope)}\n\n`));
        }
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
        socket?.emit("subscribe", options.subscription);
        send({ type: "ready" });
      });

      for (const eventName of options.events ?? ALL_SOCKET_EVENTS) {
        socket.on(eventName, (payload: unknown) => {
          const parsed = SocketEventSchemas[eventName].safeParse(payload);
          if (!parsed.success || options.shouldForward?.(eventName, parsed.data) === false) return;
          send({ type: "socket", event: eventName, payload: parsed.data });
        });
      }

      socket.on("connect_error", (error) => {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
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
