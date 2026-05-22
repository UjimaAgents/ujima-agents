import { describe, expect, it, vi } from 'vitest';
import {
  TaskSessionSchema,
  TodoSchema,
  type TaskSession,
  type Todo,
} from '@ujima/shared';
import { SupervisorTodoService } from './supervisor-todo.js';
import type { ApiRepository } from './repository-reader.js';

// Post-review regression: SupervisorTodoService.add() used to persist
// session-scoped todos with only `taskSessionId` set, which made them
// invisible to the channel views that filter strictly on
// `todos.channel_id`. The fix is to read the task session at write
// time and backfill `channelId` on the todo row so the goals rail
// and Tasks tab surface supervisor-created work too.

function buildSession(overrides: Partial<TaskSession> & { id: string }): TaskSession {
  const now = '2026-05-22T13:00:00.000Z';
  return TaskSessionSchema.parse({
    id: overrides.id,
    organizationId: overrides.organizationId ?? 'org-1',
    slug: overrides.slug ?? 'sess-slug',
    channelId: overrides.channelId ?? 'channel-1',
    requestedBy: overrides.requestedBy ?? 'member-1',
    executionMode: 'concurrent',
    status: overrides.status ?? 'running',
    prompt: '',
    summary: '',
    teamMemberIds: ['member-1'],
    origin: {},
    promotionMetadata: {},
    supervisorTurnCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}

describe('SupervisorTodoService.add — channelId backfill', () => {
  it('backfills channelId from the task session so channel views surface the todo', () => {
    const session = buildSession({ id: 'sess-1', channelId: 'channel-foo' });
    const saved: Todo[] = [];
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(session),
      saveTodo: vi.fn().mockImplementation((todo: Todo) => {
        saved.push(todo);
        return todo;
      }),
    } as unknown as ApiRepository;

    const service = new SupervisorTodoService(repo);
    const result = service.add({
      organizationId: 'org-1',
      taskSessionId: 'sess-1',
      memberId: 'member-1',
      body: 'Investigate the API timeout',
    });

    expect(repo.getTaskSession).toHaveBeenCalledWith('org-1', 'sess-1');
    expect(saved.length).toBe(1);
    expect(saved[0]!.channelId).toBe('channel-foo');
    expect(result.channelId).toBe('channel-foo');
    expect(result.taskSessionId).toBe('sess-1');
  });

  it('leaves channelId undefined when the task session is missing', () => {
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(null),
      saveTodo: vi.fn().mockImplementation((todo: Todo) => todo),
    } as unknown as ApiRepository;
    const service = new SupervisorTodoService(repo);
    const result = service.add({
      organizationId: 'org-1',
      taskSessionId: 'sess-gone',
      memberId: 'member-1',
      body: 'Orphan task',
    });
    expect(result.channelId).toBeUndefined();
    expect(result.taskSessionId).toBe('sess-gone');
  });

  it('still preserves notes and parses through TodoSchema', () => {
    const session = buildSession({ id: 'sess-2', channelId: 'channel-bar' });
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(session),
      saveTodo: vi.fn().mockImplementation((todo: Todo) => TodoSchema.parse(todo)),
    } as unknown as ApiRepository;
    const service = new SupervisorTodoService(repo);
    const result = service.add({
      organizationId: 'org-1',
      taskSessionId: 'sess-2',
      memberId: 'member-1',
      body: 'Write docs',
      notes: 'consult the spec',
    });
    expect(result.channelId).toBe('channel-bar');
    expect(result.notes).toBe('consult the spec');
  });
});
