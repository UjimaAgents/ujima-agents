import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { existsSync } from 'node:fs';
import type { Repository, RuntimeHost, Logger } from '@ujima/runtime-core';
import type {
  ApprovalService,
  BootstrapService,
  ConversationService,
  OnboardingService,
  RunService,
  SettingsService,
  TaskPromoterService,
} from '@ujima/orchestrator';
import type { UjimaEvent } from '@ujima/shared';
import {
  ApiErrorSchema,
  CreateWorkspaceRequestSchema,
  DEFAULT_BIND_HOST,
  DEFAULT_BIND_PORT,
  EventSubscribeQuerySchema,
  HealthResponseSchema,
  ListAgentsResponseSchema,
  ListTasksResponseSchema,
  ListWorkspacesResponseSchema,
  StartTaskRequestSchema,
  StartTaskResponseSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceSchema,
  type ApiError,
  type ErrorCode,
  type RunningAgent,
  type RunningTask,
  type WsFrame,
} from '@ujima/api-schema';
import { RealtimeService } from './realtime.js';
import { registerConversationRoutes } from './routes/conversations.js';
import { registerOnboardingRoutes } from './routes/onboarding.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTaskRoutes } from './routes/tasks.js';

const WS_QUEUE_CAP = 256;
const STARTED_AT = Date.now();

export interface TransportOptions {
  host: RuntimeHost;
  token: string;
  logger: Logger;
  bindHost?: string;
  port?: number;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  /**
   * When `bindHost` is non-loopback AND `tlsCertPath`/`tlsKeyPath` are not
   * provided, the transport refuses to start (no cleartext over LAN).
   * Default: true. Override only in controlled test environments.
   */
  allowInsecureNonLoopback?: boolean;
  /**
   * When provided, attaches the conversation/run/approval surface on the same
   * socket.io instance and registers `/api/channels`, `/api/threads/:id/messages`,
   * `/api/messages`, `/api/runs`, `/api/runs/:id`, `/api/approvals`, and
   * `/api/approvals/:id/resolve` routes. `buildServices` is called with the
   * constructed `RealtimeService` so callers can inject it into their
   * orchestrator layer.
   */
  apiServices?: {
    repo: Repository;
    buildServices: (realtime: RealtimeService) => {
      conversations: ConversationService;
      runs: RunService;
      approvals: ApprovalService;
      bootstrap: BootstrapService;
      onboarding: OnboardingService;
      settings: SettingsService;
      taskPromoter: TaskPromoterService;
    };
  };
}

export interface Transport {
  readonly url: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

export function createTransport(opts: TransportOptions): Transport {
  const { host, token, logger } = opts;
  const bindHost = opts.bindHost ?? DEFAULT_BIND_HOST;
  const port = opts.port ?? DEFAULT_BIND_PORT;

  if (!isLoopback(bindHost)) {
    const haveTls = opts.tlsCertPath && opts.tlsKeyPath && existsSync(opts.tlsCertPath) && existsSync(opts.tlsKeyPath);
    if (!haveTls && !opts.allowInsecureNonLoopback) {
      throw new Error(
        `transport: refusing to bind non-loopback host "${bindHost}" without TLS cert/key. ` +
          `Set tlsCertPath+tlsKeyPath or bind to 127.0.0.1.`,
      );
    }
  }

  const fastify: FastifyInstance = Fastify({ logger: false });

  fastify.addHook('onRequest', async (req, reply) => {
    // Bearer token check applies to every REST call. WS auth is handled in
    // the io connection handler below. /health is intentionally gated too —
    // an unauthenticated health probe leaks deployment info.
    const auth = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/.exec(auth);
    if (!match || match[1] !== token) {
      return replyError(reply, 401, 'ERR_UNAUTHORIZED', 'missing or invalid bearer token');
    }
  });

  fastify.get('/health', async () => {
    return HealthResponseSchema.parse({
      status: 'ok',
      version: 'v1',
      uptimeMs: Date.now() - STARTED_AT,
      pid: process.pid,
    });
  });

  fastify.get('/workspaces', async () => {
    return ListWorkspacesResponseSchema.parse({
      workspaces: host.workspaces.list().map(toWorkspaceDto),
    });
  });

  fastify.post('/workspaces', async (req, reply) => {
    const parsed = CreateWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) return replyBadRequest(reply, parsed.error.message);
    const ws = host.workspaces.create({
      id: parsed.data.id,
      root_path: parsed.data.root_path ?? null,
      label: parsed.data.label ?? null,
    });
    return WorkspaceSchema.parse(toWorkspaceDto(ws));
  });

  fastify.get('/workspaces/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ws = host.workspaces.get(id);
    if (!ws) return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    return WorkspaceSchema.parse(toWorkspaceDto(ws));
  });

  fastify.put('/workspaces/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = UpdateWorkspaceRequestSchema.safeParse(req.body);
    if (!parsed.success) return replyBadRequest(reply, parsed.error.message);
    try {
      const ws = host.workspaces.update(id, parsed.data);
      return WorkspaceSchema.parse(toWorkspaceDto(ws));
    } catch (err) {
      return replyError(reply, 404, 'ERR_NOT_FOUND', errMessage(err));
    }
  });

  fastify.delete('/workspaces/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const ok = host.workspaces.remove(id);
    if (!ok) return replyError(reply, 404, 'ERR_NOT_FOUND', `workspace "${id}" not found`);
    return { removed: true };
  });

  fastify.get('/tasks', async () => {
    return ListTasksResponseSchema.parse({ tasks: host.listTasks().map(toTaskDto) });
  });

  fastify.get('/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const t = host.listTasks().find((x) => x.taskId === id);
    if (!t) return replyError(reply, 404, 'ERR_NOT_FOUND', `task "${id}" not found`);
    return toTaskDto(t);
  });

  fastify.post('/tasks', async (req, reply) => {
    const parsed = StartTaskRequestSchema.safeParse(req.body);
    if (!parsed.success) return replyBadRequest(reply, parsed.error.message);
    try {
      const res = await host.startTask({
        workspaceId: parsed.data.workspace_id,
        sessionId: parsed.data.session_id,
        teamId: parsed.data.team_id,
        prompt: parsed.data.prompt,
        taskId: parsed.data.task_id,
        orchestratorMode: parsed.data.orchestrator_mode,
        executionMode: parsed.data.execution_mode,
      });
      return StartTaskResponseSchema.parse({
        task: toTaskDto({
          taskId: res.task.task_id,
          sessionId: parsed.data.session_id,
          workspaceId: parsed.data.workspace_id,
          teamId: res.team.team_id,
          startedAt: Date.now(),
          agentIds: res.handle.agentIds(),
        }),
      });
    } catch (err) {
      return mapHostError(reply, err);
    }
  });

  fastify.delete('/tasks/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    return { killed: host.killTask(id) };
  });

  fastify.post('/tasks/:taskId/agents/:agentId/kill', async (req) => {
    const { taskId, agentId } = req.params as { taskId: string; agentId: string };
    return { killed: host.killAgent(taskId, agentId) };
  });

  fastify.get('/agents', async () => {
    return ListAgentsResponseSchema.parse({ agents: host.listAgents().map(toAgentDto) });
  });

  fastify.setErrorHandler((err, _req, reply) => {
    logger.error('transport: unhandled error', { error: err.message, stack: err.stack });
    return replyError(reply, 500, 'ERR_INTERNAL', err.message);
  });

  const io = new SocketIOServer(fastify.server, {
    path: '/events',
    cors: { origin: false },
    maxHttpBufferSize: 1024 * 64,
    pingTimeout: 20_000,
  });
  io.use((socket, next) => {
    const authHeader = socket.handshake.auth?.token ?? socket.handshake.headers.authorization ?? '';
    const bearerMatch = /^Bearer\s+(.+)$/.exec(String(authHeader));
    const raw = typeof authHeader === 'string' && !bearerMatch ? authHeader : bearerMatch?.[1];
    if (raw !== token) return next(new Error('ERR_UNAUTHORIZED'));
    next();
  });
  io.on('connection', onSocketConnection);

  if (opts.apiServices) {
    const realtime = new RealtimeService(io, opts.apiServices.repo);
    const services = opts.apiServices.buildServices(realtime);
    registerConversationRoutes(fastify, { conversations: services.conversations });
    registerRunRoutes(fastify, { runs: services.runs, approvals: services.approvals });
    registerOnboardingRoutes(fastify, {
      bootstrap: services.bootstrap,
      onboarding: services.onboarding,
    });
    registerSettingsRoutes(fastify, { settings: services.settings });
    registerTaskRoutes(fastify, { taskPromoter: services.taskPromoter });
  }

  function onSocketConnection(socket: Socket): void {
    const parsed = EventSubscribeQuerySchema.safeParse(socket.handshake.query);
    if (!parsed.success) {
      socket.emit('error', { code: 'ERR_BAD_REQUEST', message: parsed.error.message });
      socket.disconnect(true);
      return;
    }
    const filter = parsed.data;
    const queue: WsFrame[] = [];
    let overflowed = false;
    let flushing = false;

    const send = (frame: WsFrame): void => {
      if (overflowed) return;
      if (queue.length >= WS_QUEUE_CAP) {
        overflowed = true;
        const overflowFrame: WsFrame = { kind: 'overflow', dropped: queue.length, code: 1008 };
        socket.emit('frame', overflowFrame);
        socket.disconnect(true);
        return;
      }
      queue.push(frame);
      if (!flushing) flush();
    };
    const flush = (): void => {
      flushing = true;
      // Drain in microtask so we coalesce sync bus deliveries.
      queueMicrotask(() => {
        while (socket.connected) {
          const next = queue.shift();
          if (next === undefined) break;
          socket.emit('frame', next);
        }
        flushing = false;
      });
    };

    // NOTE: workspace-scoped event filtering lands with Epic 12.9 workspace_id
    // threading through the orchestrator. For now the filter is advisory
    // and accepted for forward compatibility.
    const subscription = host.subscribeEvents(
      {
        sessionId: filter.session_id,
        taskId: filter.task_id,
        agentId: filter.agent_id,
        channel: filter.channel,
        eventType: filter.event_type,
        replaySinceMs: filter.since_ms,
      },
      (event: UjimaEvent) => send({ kind: 'event', event }),
    );

    socket.on('disconnect', () => {
      subscription.unsubscribe();
    });

    send({ kind: 'ready', since_ms: filter.since_ms });
  }

  let readyUrl = '';

  return {
    get url() {
      return readyUrl;
    },
    async listen() {
      await fastify.ready();
      readyUrl = await fastify.listen({ host: bindHost, port });
      logger.info('transport: listening', { url: readyUrl });
    },
    async close() {
      io.close();
      await fastify.close();
    },
  };
}

function toWorkspaceDto(ws: { id: string; root_path: string | null; label: string | null; created_at: number; updated_at: number }): {
  id: string; root_path: string | null; label: string | null; created_at: number; updated_at: number;
} {
  return { ...ws };
}

function toTaskDto(t: {
  taskId: string;
  sessionId: string;
  workspaceId: string;
  teamId: string;
  startedAt: number;
  agentIds: string[];
}): RunningTask {
  return {
    task_id: t.taskId,
    session_id: t.sessionId,
    workspace_id: t.workspaceId,
    team_id: t.teamId,
    started_at: t.startedAt,
    agent_ids: t.agentIds,
  };
}

function toAgentDto(a: {
  agentId: string;
  taskId: string;
  sessionId: string;
  workspaceId: string;
  startedAt: number;
}): RunningAgent {
  return {
    agent_id: a.agentId,
    task_id: a.taskId,
    session_id: a.sessionId,
    workspace_id: a.workspaceId,
    started_at: a.startedAt,
  };
}

function replyError(reply: FastifyReply, status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): FastifyReply {
  const body: ApiError = { code, message, ...(details ? { details } : {}) };
  return reply.status(status).send(ApiErrorSchema.parse(body));
}

function replyBadRequest(reply: FastifyReply, message: string): FastifyReply {
  return replyError(reply, 400, 'ERR_BAD_REQUEST', message);
}

function mapHostError(reply: FastifyReply, err: unknown): FastifyReply {
  const e = err as { code?: string; message?: string };
  if (e.code === 'ERR_NO_WORKSPACE_ROOT') return replyError(reply, 409, 'ERR_NO_WORKSPACE_ROOT', errMessage(err));
  if (e.code === 'ERR_PATH_ESCAPE') return replyError(reply, 403, 'ERR_PATH_ESCAPE', errMessage(err));
  if (/shutting down/i.test(e.message ?? '')) return replyError(reply, 503, 'ERR_SHUTTING_DOWN', errMessage(err));
  return replyError(reply, 500, 'ERR_INTERNAL', errMessage(err));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { FastifyRequest };
