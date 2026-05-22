import { z } from 'zod';
import { TaskFileSchema } from './task-files.js';

export * from './conversations.js';
export * from './auth.js';
export * from './onboarding.js';
export * from './runs.js';
export * from './settings.js';
export { orgWorkspaceId, organizationIdFromWorkspaceId } from '@ujima/shared';
export * from './task-sessions.js';
export * from './task-files.js';
export * from './mcps.js';
export * from './schedules.js';
export * from './additive/requests.js';
export { MODEL_OPTIONS_BY_PROVIDER, defaultModelForProvider, getModelOptionsForProvider } from './model-catalog.js';

export const API_VERSION = 'v1';

export const ErrorCodeSchema = z.enum([
  'ERR_UNAUTHORIZED',
  'ERR_FORBIDDEN',
  'ERR_NOT_FOUND',
  'ERR_BAD_REQUEST',
  'ERR_CONFLICT',
  'ERR_RATE_LIMITED',
  'ERR_INTERNAL',
  'ERR_NO_WORKSPACE_ROOT',
  'ERR_PATH_ESCAPE',
  'ERR_SHUTTING_DOWN',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeMs: z.number(),
  pid: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const WorkspaceSchema = z.object({
  id: z.string(),
  root_path: z.string().nullable(),
  label: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceRequestSchema = z.object({
  id: z.string().min(1).optional(),
  root_path: z.string().optional(),
  label: z.string().optional(),
});
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

export const UpdateWorkspaceRequestSchema = z.object({
  root_path: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
});
export type UpdateWorkspaceRequest = z.infer<typeof UpdateWorkspaceRequestSchema>;

export const WorkspaceListItemSchema = WorkspaceSchema.extend({
  is_current: z.boolean().optional(),
});

export const ListWorkspacesResponseSchema = z.object({
  workspaces: z.array(WorkspaceListItemSchema),
  current_root_path: z.string().nullable().optional(),
  current_workspace_id: z.string().nullable().optional(),
});
export type ListWorkspacesResponse = z.infer<typeof ListWorkspacesResponseSchema>;

export const ActivateWorkspaceResponseSchema = z.object({
  workspace: WorkspaceSchema,
  workspaceRoot: z.string(),
});
export type ActivateWorkspaceResponse = z.infer<typeof ActivateWorkspaceResponseSchema>;

export const StartTaskRequestSchema = z.object({
  workspace_id: z.string().min(1),
  session_id: z.string().min(1),
  team_id: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  task_id: z.string().optional(),
  orchestrator_mode: z.enum(['auto', 'manual']).optional(),
  execution_mode: z.enum(['concurrent', 'slim']).optional(),
  task_file: TaskFileSchema.optional(),
}).superRefine((value, ctx) => {
  if (!value.prompt && !value.task_file) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['prompt'],
      message: 'prompt is required when task_file is omitted',
    });
  }
  if (!value.team_id && !value.task_file?.team.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['team_id'],
      message: 'team_id or task_file.team is required',
    });
  }
});
export type StartTaskRequest = z.infer<typeof StartTaskRequestSchema>;

export const RunningTaskSchema = z.object({
  task_id: z.string(),
  session_id: z.string(),
  workspace_id: z.string(),
  team_id: z.string(),
  started_at: z.number(),
  agent_ids: z.array(z.string()),
});
export type RunningTask = z.infer<typeof RunningTaskSchema>;

export const StartTaskResponseSchema = z.object({ task: RunningTaskSchema });
export type StartTaskResponse = z.infer<typeof StartTaskResponseSchema>;

export const ListTasksResponseSchema = z.object({ tasks: z.array(RunningTaskSchema) });
export type ListTasksResponse = z.infer<typeof ListTasksResponseSchema>;

export const RunningAgentSchema = z.object({
  agent_id: z.string(),
  task_id: z.string(),
  session_id: z.string(),
  workspace_id: z.string(),
  started_at: z.number(),
});
export type RunningAgent = z.infer<typeof RunningAgentSchema>;

export const ListAgentsResponseSchema = z.object({ agents: z.array(RunningAgentSchema) });
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;

export const KillResponseSchema = z.object({ killed: z.boolean() });
export type KillResponse = z.infer<typeof KillResponseSchema>;

export const EventSubscribeQuerySchema = z.object({
  session_id: z.string().optional(),
  task_id: z.string().optional(),
  agent_id: z.string().optional(),
  channel: z.string().optional(),
  event_type: z.string().optional(),
  since_ms: z.coerce.number().optional(),
});
export type EventSubscribeQuery = z.infer<typeof EventSubscribeQuerySchema>;

export const WsFrameSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: z.unknown() }),
  z.object({ kind: z.literal('overflow'), dropped: z.number(), code: z.literal(1008) }),
  z.object({ kind: z.literal('ready'), since_ms: z.number().optional() }),
]);
export type WsFrame = z.infer<typeof WsFrameSchema>;

export const DEFAULT_BIND_HOST = '127.0.0.1';
export const DEFAULT_BIND_PORT = 7511;
export const BEARER_TOKEN_ENV = 'UJIMA_TOKEN';
export const TOKEN_FILENAME = 'token';
