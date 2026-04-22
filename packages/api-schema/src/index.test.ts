import { describe, it, expect } from 'vitest';
import {
  ApiErrorSchema,
  CreateWorkspaceRequestSchema,
  StartTaskRequestSchema,
  WsFrameSchema,
  DEFAULT_BIND_HOST,
  DEFAULT_BIND_PORT,
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

  it('requires workspace_id, session_id, team_id, prompt on StartTaskRequest', () => {
    expect(
      StartTaskRequestSchema.safeParse({
        workspace_id: 'w',
        session_id: 's',
        team_id: 't',
        prompt: 'hi',
      }).success,
    ).toBe(true);
    expect(StartTaskRequestSchema.safeParse({}).success).toBe(false);
  });

  it('discriminates WsFrame variants', () => {
    expect(WsFrameSchema.safeParse({ kind: 'ready' }).success).toBe(true);
    expect(WsFrameSchema.safeParse({ kind: 'event', event: { any: 'payload' } }).success).toBe(true);
    expect(
      WsFrameSchema.safeParse({ kind: 'overflow', dropped: 10, code: 1008 }).success,
    ).toBe(true);
    expect(WsFrameSchema.safeParse({ kind: 'boom' }).success).toBe(false);
  });

  it('exposes bind defaults', () => {
    expect(DEFAULT_BIND_HOST).toBe('127.0.0.1');
    expect(DEFAULT_BIND_PORT).toBe(7511);
  });
});
