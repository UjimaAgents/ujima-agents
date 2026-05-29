import { describe, it, expect } from 'vitest';
import {
  ApiErrorSchema,
  CreateWorkspaceRequestSchema,
  StartTaskRequestSchema,
  TaskFileSchema,
  WsFrameSchema,
} from './index';

describe('api-schema', () => {
  it('parses a valid ApiError', () => {
    expect(
      ApiErrorSchema.safeParse({ code: 'ERR_UNAUTHORIZED', message: 'no token' }).success,
    ).toBe(true);
  });

  it('rejects an ApiError with an unknown code', () => {
    expect(ApiErrorSchema.safeParse({ code: 'ERR_BANANA', message: 'x' }).success).toBe(false);
  });

  it('accepts an empty CreateWorkspaceRequest', () => {
    expect(CreateWorkspaceRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts direct task start requests', () => {
    expect(
      StartTaskRequestSchema.safeParse({
        workspace_id: 'w',
        session_id: 's',
        team_id: 't',
        prompt: 'hi',
      }).success,
    ).toBe(true);
  });

  it('accepts task-file based start requests', () => {
    expect(
      StartTaskRequestSchema.safeParse({
        workspace_id: 'w',
        session_id: 's',
        task_file: {
          task_id: 'auth-refresh',
          prompt: 'Refresh the auth flow',
          team: ['frontend-alice', 'frontend-bob'],
          execution_mode: 'slim',
          approvals: { mode: 'human_all' },
          sequence: ['frontend-alice', 'frontend-bob'],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects empty task starts', () => {
    expect(StartTaskRequestSchema.safeParse({}).success).toBe(false);
  });

  it('parses a valid task YAML payload shape', () => {
    expect(
      TaskFileSchema.safeParse({
        task_id: 'auth-refresh',
        prompt: 'Refresh the auth flow',
        team: ['frontend-alice', 'frontend-bob'],
        execution_mode: 'slim',
        approvals: { mode: 'human_all' },
        sequence: ['frontend-alice', 'frontend-bob'],
      }).success,
    ).toBe(true);
  });

  it('discriminates WsFrame variants', () => {
    expect(WsFrameSchema.safeParse({ kind: 'ready' }).success).toBe(true);
    expect(WsFrameSchema.safeParse({ kind: 'event', event: { any: 'payload' } }).success).toBe(true);
    expect(
      WsFrameSchema.safeParse({ kind: 'overflow', dropped: 10, code: 1008 }).success,
    ).toBe(true);
    expect(WsFrameSchema.safeParse({ kind: 'boom' }).success).toBe(false);
  });
});
