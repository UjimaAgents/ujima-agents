import {readFileSync} from "node:fs";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {Server as SocketIOServer, type Socket} from "socket.io";
import type {Repository, RuntimeHost, Logger} from "@ujima/runtime-core";
import type {
  ActiveSpiritRegistry,
  ApprovalService,
  AuthService,
  BootstrapService,
  ConversationService,
  McpRegistryService,
  OnboardingService,
  SchedulerService,
  SettingsService,
  SpiritService,
  SupervisorTodoService,
  TaskPromoterService,
  TaskSessionService,
} from "@ujima/orchestrator";
import type {UjimaEvent} from "@ujima/shared";
import {
  ApiErrorSchema,
  DEFAULT_BIND_HOST,
  DEFAULT_BIND_PORT,
  EventSubscribeQuerySchema,
  HealthResponseSchema,
  type ErrorCode,
  type WsFrame,
} from "@ujima/api-schema";
import {z} from "zod";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {RealtimeService} from "./realtime.js";
import {registerAttachmentRoutes} from "./routes/attachments.js";
import {registerConversationRoutes} from "./routes/conversations.js";
import {registerAuthRoutes} from "./routes/auth.js";
import {registerOnboardingRoutes} from "./routes/onboarding.js";
import {registerRunRoutes} from "./routes/runs.js";
import {registerRoleRoutes} from "./routes/roles.js";
import {registerSettingsRoutes} from "./routes/settings.js";
import {registerTaskRoutes} from "./routes/tasks.js";
import {registerTaskSessionRoutes} from "./routes/task-sessions.js";
import {registerMcpRoutes} from "./routes/mcps.js";
import {registerChannelGoalsRoutes} from "./routes/channel-goals.js";
import {registerChannelTasksRoutes} from "./routes/channel-tasks.js";
import {registerWorkspaceRoutes} from "./routes/workspaces.js";
import {registerAgentRoutes} from "./routes/agents.js";
import {registerOauthRoutes} from "./routes/oauth.js";
import {registerScheduleRoutes} from "./routes/schedules.js";

const WS_QUEUE_CAP = 256;
const STARTED_AT = Date.now();
const EventHandshakeResponseSchema = z.object({
  status: z.literal("ready"),
  transport: z.literal("socket.io"),
  path: z.literal("/events"),
});

export interface TransportOptions {
  host: RuntimeHost;
  token: string;
  logger: Logger;
  bindHost?: string;
  port?: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  apiServices?: {
    repo: Repository;
    buildServices: (realtime: RealtimeService) => {
      conversations: ConversationService;
      runs: SpiritService;
      approvals: ApprovalService;
      auth: AuthService;
      bootstrap: BootstrapService;
      onboarding: OnboardingService;
      scheduler?: SchedulerService;
      settings: SettingsService;
      taskPromoter: TaskPromoterService;
      taskSessions: TaskSessionService;
      spirits: SpiritService;
      supervisorTodos: SupervisorTodoService;
      activeSpirits: ActiveSpiritRegistry;
      mcpRegistry: McpRegistryService;
    };
  };
}

export interface Transport {
  readonly url: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export function createTransport(opts: TransportOptions): Transport {
  const {host, token, logger} = opts;
  const bindHost = opts.bindHost ?? DEFAULT_BIND_HOST;
  const port = opts.port ?? DEFAULT_BIND_PORT;
  const useTls = Boolean(opts.tlsCertPath && opts.tlsKeyPath);
  const tlsKeyPath = opts.tlsKeyPath;
  const tlsCertPath = opts.tlsCertPath;

  if (!bindHostIsLoopback(bindHost) && !useTls) {
    throw new Error("non-loopback bind requires TLS");
  }

  const fastify: FastifyInstance = Fastify({
    logger: false,
    forceCloseConnections: true,
    ...(useTls && tlsKeyPath && tlsCertPath
      ? {
          https: {
            key: readFileSync(tlsKeyPath),
            cert: readFileSync(tlsCertPath),
          },
        }
      : {}),
  });

  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(serializerCompiler);

  // Documentation (Public)
  fastify.register(swagger, {
    openapi: {
      info: {
        title: "Ujima Agents API",
        description: "Local control plane for running AI software teams",
        version: "1.0.0",
      },
      tags: [
        {name: "Agents"},
        {name: "Attachments"},
        {name: "Conversations"},
        {name: "Onboarding"},
        {name: "Runs"},
        {name: "Roles"},
        {name: "Schedules"},
        {name: "Settings"},
        {name: "System"},
        {name: "Tasks"},
        {name: "Workspaces"},
      ],
      servers: [
        {url: `${useTls ? "https" : "http"}://${bindHost}:${port}/api`},
      ],
      components: {
        securitySchemes: {
          bearerAuth: {type: "http", scheme: "bearer"},
        },
      },
      security: [{bearerAuth: []}],
    },
    transform: jsonSchemaTransform,
  });

  fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {docExpansion: "list", deepLinking: false},
  });

  // Health Check (Public)
  fastify.get(
    "/health",
    {
      schema: {
        description: "Check system health and uptime",
        tags: ["System"],
        response: {200: HealthResponseSchema},
      },
    },
    async () => {
      return {
        status: "ok",
        version: "v1",
        uptimeMs: Date.now() - STARTED_AT,
        pid: process.pid,
      };
    }
  );

  // Socket.IO Handshake
  const io = new SocketIOServer(fastify.server, {
    path: "/events",
    cors: {origin: false},
  });
  let scheduler: SchedulerService | undefined;

  fastify.get(
    "/events",
    {
      schema: {
        description: "Realtime event stream (Socket.IO)",
        tags: ["System"],
        response: {
          200: EventHandshakeResponseSchema,
        },
      },
    },
    async () => {
      return {
        status: "ready",
        transport: "socket.io",
        path: "/events",
      };
    }
  );

  io.use((socket, next) => {
    const authHeader =
      socket.handshake.auth?.token ??
      socket.handshake.headers.authorization ??
      "";
    const bearerMatch = /^Bearer\s+(.+)$/.exec(String(authHeader));
    const raw =
      typeof authHeader === "string" && !bearerMatch
        ? authHeader
        : bearerMatch?.[1];
    if (raw !== token) return next(new Error("ERR_UNAUTHORIZED"));
    next();
  });

  io.on("connection", (socket) => onSocketConnection(socket, host));

  // Public APIs (No Auth Required)
  fastify.register(
    async (api) => {
      registerOauthRoutes(api);
    },
    {prefix: "/api"}
  );

  // Data API (Authenticated)
  fastify.register(
    async (api) => {
      api.addHook("onRequest", async (req, reply) => {
        const auth = req.headers.authorization ?? "";
        const match = /^Bearer\s+(.+)$/.exec(auth);
        if (!match || match[1] !== token) {
          return replyError(
            reply,
            401,
            "ERR_UNAUTHORIZED",
            "missing or invalid bearer token"
          );
        }
      });

      registerAgentRoutes(api, host);
      registerRoleRoutes(api);

      if (opts.apiServices) {
        const realtime = new RealtimeService(io, opts.apiServices.repo);
        const services = opts.apiServices.buildServices(realtime);

        registerWorkspaceRoutes(api, {
          host,
          repo: opts.apiServices.repo,
          auth: services.auth,
          settings: services.settings,
        });

        api.register(multipart, {
          limits: {fileSize: 25 * 1024 * 1024},
        });
        registerAttachmentRoutes(api, {
          repo: opts.apiServices.repo,
          auth: services.auth,
        });

        registerConversationRoutes(api, {
          repo: opts.apiServices.repo,
          conversations: services.conversations,
          auth: services.auth,
          taskPromoter: services.taskPromoter,
        });
        registerRunRoutes(api, {
          repo: opts.apiServices.repo,
          runs: services.runs,
          approvals: services.approvals,
          auth: services.auth,
        });
        registerAuthRoutes(api, {auth: services.auth});
        registerOnboardingRoutes(api, {
          auth: services.auth,
          bootstrap: services.bootstrap,
          onboarding: services.onboarding,
        });
        registerSettingsRoutes(api, {
          repo: opts.apiServices.repo,
          settings: services.settings,
          auth: services.auth,
        });
        registerTaskRoutes(api, {
          host,
          repo: opts.apiServices.repo,
          taskPromoter: services.taskPromoter,
        });
        registerTaskSessionRoutes(api, {
          taskSessions: services.taskSessions,
          repo: opts.apiServices.repo,
        });
        registerMcpRoutes(api, {
          auth: services.auth,
          mcpRegistry: services.mcpRegistry,
        });
        registerChannelGoalsRoutes(api, {
          repo: opts.apiServices.repo,
          auth: services.auth,
        });
        registerChannelTasksRoutes(api, {
          repo: opts.apiServices.repo,
          auth: services.auth,
          realtime,
        });
        registerScheduleRoutes(api, {
          repo: opts.apiServices.repo,
          auth: services.auth,
        });
        scheduler = services.scheduler;
        scheduler?.start();
      }
    },
    {prefix: "/api"}
  );

  fastify.setErrorHandler((err, req, reply) => {
    logger.error("transport: unhandled error", {
      url: req.url,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
    return replyError(reply, 500, "ERR_INTERNAL", err.message);
  });

  let readyUrl = "";

  return {
    get url() {
      return readyUrl;
    },
    async listen() {
      await fastify.ready();
      readyUrl = await fastify.listen({host: bindHost, port});
      logger.info("transport: listening", {url: readyUrl});
    },
    async close() {
      scheduler?.stop();
      io.disconnectSockets(true);
      io.close();
      await fastify.close();
    },
  };
}

function bindHostIsLoopback(bindHost: string): boolean {
  return (
    bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1"
  );
}

function onSocketConnection(socket: Socket, host: RuntimeHost): void {
  const parsed = EventSubscribeQuerySchema.safeParse(socket.handshake.query);
  if (!parsed.success) {
    socket.emit("error", {
      code: "ERR_BAD_REQUEST",
      message: parsed.error.message,
    });
    socket.disconnect(true);
    return;
  }
  const filter = parsed.data;
  const queue: WsFrame[] = [];
  let flushing = false;

  const send = (frame: WsFrame): void => {
    if (queue.length >= WS_QUEUE_CAP) {
      socket.emit("frame", {
        kind: "overflow",
        dropped: queue.length,
        code: 1008,
      });
      socket.disconnect(true);
      return;
    }
    queue.push(frame);
    if (!flushing) flush();
  };

  const flush = (): void => {
    flushing = true;
    queueMicrotask(() => {
      while (socket.connected) {
        const next = queue.shift();
        if (next === undefined) break;
        socket.emit("frame", next);
      }
      flushing = false;
    });
  };

  const subscription = host.subscribeEvents(
    {
      sessionId: filter.session_id,
      taskId: filter.task_id,
      agentId: filter.agent_id,
      channel: filter.channel,
      eventType: filter.event_type,
      replaySinceMs: filter.since_ms,
    },
    (event: UjimaEvent) => send({kind: "event", event})
  );

  socket.on("disconnect", () => subscription.unsubscribe());
  send({kind: "ready", since_ms: filter.since_ms});
}

function replyError(
  reply: FastifyReply,
  status: number,
  code: ErrorCode,
  message: string
): FastifyReply {
  return reply.status(status).send(ApiErrorSchema.parse({code, message}));
}

export type {FastifyRequest};
