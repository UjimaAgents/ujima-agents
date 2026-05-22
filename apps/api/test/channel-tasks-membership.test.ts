import { describe, expect, it, vi } from 'vitest';
import { resolveChannelTaskMembership } from '../src/transport/routes/channel-tasks.js';
import type { ApiRepository } from '@ujima/orchestrator';
import { TaskSessionSchema, type TaskSession } from '@ujima/shared';

/**
 * Post-review regression for the channel Tasks tab PATCH route.
 *
 * `listTodosForChannel` (the GET path) was extended to union direct
 * `todos.channel_id` membership with `task_sessions.channel_id` so
 * legacy supervisor-created rows surface in the Tasks tab. The PATCH
 * handler used to enforce only the direct match, which 404'd those
 * same rows when a user clicked Done / Block / Cancel — defeating the
 * point of surfacing them. The membership rule has been extracted
 * into `resolveChannelTaskMembership` so the GET and PATCH paths
 * cannot drift again, and so this exact regression is covered.
 */

function buildSession(channelId: string): TaskSession {
  const now = '2026-05-22T15:00:00.000Z';
  return TaskSessionSchema.parse({
    id: 'sess-1',
    organizationId: 'org-1',
    slug: 'sess-1-slug',
    channelId,
    requestedBy: 'member-1',
    executionMode: 'concurrent',
    status: 'running',
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

describe('resolveChannelTaskMembership', () => {
  it('accepts a direct channelId match without consulting the task session', () => {
    const getTaskSession = vi.fn();
    const repo = { getTaskSession } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1', channelId: 'channel-A', taskSessionId: 'sess-1' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: true, viaSession: false });
    expect(getTaskSession).not.toHaveBeenCalled();
  });

  it('accepts a session-scoped todo whose task session belongs to the target channel', () => {
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(buildSession('channel-A')),
    } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1', taskSessionId: 'sess-1' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: true, viaSession: true });
  });

  it('rejects a todo whose task session belongs to a different channel', () => {
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(buildSession('channel-OTHER')),
    } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1', taskSessionId: 'sess-1' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: false, viaSession: false });
  });

  it('rejects a todo with no channelId and no taskSessionId (orphan row)', () => {
    const repo = {
      getTaskSession: vi.fn(),
    } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: false, viaSession: false });
  });

  it('rejects when the task session lookup returns null (stale session id)', () => {
    const repo = {
      getTaskSession: vi.fn().mockReturnValue(null),
    } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1', taskSessionId: 'sess-missing' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: false, viaSession: false });
  });

  it('prefers the direct channelId match even when the session would also match (no extra lookup)', () => {
    const getTaskSession = vi.fn().mockReturnValue(buildSession('channel-A'));
    const repo = { getTaskSession } as unknown as Pick<ApiRepository, 'getTaskSession'>;
    const result = resolveChannelTaskMembership(
      repo,
      { organizationId: 'org-1', channelId: 'channel-A', taskSessionId: 'sess-1' },
      'channel-A',
    );
    expect(result).toEqual({ belongs: true, viaSession: false });
    expect(getTaskSession).not.toHaveBeenCalled();
  });
});
