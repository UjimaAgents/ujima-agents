import { io, type Socket } from 'socket.io-client';
import type {
  ApiError,
  CreateWorkspaceRequest,
  EventSubscribeQuery,
  HealthResponse,
  ListAgentsResponse,
  ListTasksResponse,
  ListWorkspacesResponse,
  StartTaskRequest,
  StartTaskResponse,
  UpdateWorkspaceRequest,
  Workspace,
  WsFrame,
} from '@ujima/api-schema';

export class UjimaApiError extends Error {
  readonly status: number;
  readonly code: ApiError['code'];
  readonly details?: Record<string, unknown>;
  constructor(status: number, body: ApiError) {
    super(`${body.code}: ${body.message}`);
    this.name = 'UjimaApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export interface ClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface UjimaClient {
  readonly baseUrl: string;
  health(): Promise<HealthResponse>;
  workspaces: {
    list(): Promise<ListWorkspacesResponse>;
    create(input: CreateWorkspaceRequest): Promise<Workspace>;
    get(id: string): Promise<Workspace>;
    update(id: string, patch: UpdateWorkspaceRequest): Promise<Workspace>;
    remove(id: string): Promise<{ removed: boolean }>;
  };
  tasks: {
    list(): Promise<ListTasksResponse>;
    get(id: string): Promise<ListTasksResponse['tasks'][number]>;
    start(input: StartTaskRequest): Promise<StartTaskResponse>;
    kill(id: string): Promise<{ killed: boolean }>;
    killAgent(taskId: string, agentId: string): Promise<{ killed: boolean }>;
  };
  agents: {
    list(): Promise<ListAgentsResponse>;
  };
  subscribeEvents(
    filter: EventSubscribeQuery,
    handler: (frame: WsFrame) => void,
  ): EventSubscription;
}

export interface EventSubscription {
  readonly connected: boolean;
  close(): void;
}

export function createClient(opts: ClientOptions): UjimaClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const apiBaseUrl = baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function request<T>(root: string, method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${opts.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text.length > 0 ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new UjimaApiError(res.status, data as ApiError);
    }
    return data as T;
  }

  return {
    baseUrl,
    health: () => request<HealthResponse>(baseUrl, 'GET', '/health'),
    workspaces: {
      list: () => request<ListWorkspacesResponse>(apiBaseUrl, 'GET', '/workspaces'),
      create: (input) => request<Workspace>(apiBaseUrl, 'POST', '/workspaces', input),
      get: (id) => request<Workspace>(apiBaseUrl, 'GET', `/workspaces/${encodeURIComponent(id)}`),
      update: (id, patch) => request<Workspace>(apiBaseUrl, 'PUT', `/workspaces/${encodeURIComponent(id)}`, patch),
      remove: (id) => request<{ removed: boolean }>(apiBaseUrl, 'DELETE', `/workspaces/${encodeURIComponent(id)}`),
    },
    tasks: {
      list: () => request<ListTasksResponse>(apiBaseUrl, 'GET', '/tasks'),
      get: (id) => request<ListTasksResponse['tasks'][number]>(apiBaseUrl, 'GET', `/tasks/${encodeURIComponent(id)}`),
      start: (input) => request<StartTaskResponse>(apiBaseUrl, 'POST', '/tasks', input),
      kill: (id) => request<{ killed: boolean }>(apiBaseUrl, 'DELETE', `/tasks/${encodeURIComponent(id)}`),
      killAgent: (taskId, agentId) =>
        request<{ killed: boolean }>(
          apiBaseUrl,
          'POST',
          `/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentId)}/kill`,
        ),
    },
    agents: {
      list: () => request<ListAgentsResponse>(apiBaseUrl, 'GET', '/agents'),
    },
    subscribeEvents(filter, handler) {
      const query: Record<string, string> = {};
      if (filter.session_id) query.session_id = filter.session_id;
      if (filter.task_id) query.task_id = filter.task_id;
      if (filter.agent_id) query.agent_id = filter.agent_id;
      if (filter.channel) query.channel = filter.channel;
      if (filter.event_type) query.event_type = filter.event_type;
      if (filter.since_ms !== undefined) query.since_ms = String(filter.since_ms);

      const socket: Socket = io(baseUrl, {
        path: '/events',
        transports: ['websocket'],
        auth: { token: opts.token },
        query,
        reconnection: false,
      });
      socket.on('frame', (frame: WsFrame) => handler(frame));
      return {
        get connected() {
          return socket.connected;
        },
        close() {
          socket.disconnect();
        },
      };
    },
  };
}

export type { ApiError, Workspace, StartTaskRequest, StartTaskResponse };
