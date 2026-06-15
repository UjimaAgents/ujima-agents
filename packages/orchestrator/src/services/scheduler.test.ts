import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  computeNextCronRun,
  parseCronExpression,
  resolveScheduledJobNextRunAt,
  SchedulerService,
} from './scheduler.js';
import { channelRoom, orgRoom, SocketEventNames } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';

describe('parseCronExpression', () => {
  it('returns null for invalid field count', () => {
    expect(parseCronExpression('* * * *')).toBeNull();
    expect(parseCronExpression('')).toBeNull();
    expect(parseCronExpression('* * * * * *')).toBeNull();
  });

  it('matches wildcard (any time)', () => {
    const matcher = parseCronExpression('* * * * *');
    expect(matcher).not.toBeNull();
    expect(matcher!(new Date('2025-01-15T10:30:00'))).not.toBeNull();
  });

  it('returns null for non-numeric values in field', () => {
    expect(parseCronExpression('abc * * * *')).toBeNull();
    expect(parseCronExpression('* * * * abc')).toBeNull();
  });

});

describe('computeNextCronRun', () => {
  it('returns the next cron boundary strictly after the reference time', () => {
    const next = computeNextCronRun('0 9 * * *', new Date('2025-01-15T08:30:00'));
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
    expect(next!.getTime()).toBeGreaterThan(new Date('2025-01-15T08:30:00').getTime());
  });

});

describe('resolveScheduledJobNextRunAt', () => {
  const existing = {
    cronExpression: '0 9 * * *',
    status: 'paused',
    nextRunAt: '2020-01-01T09:00:00.000Z',
  };

  it('recomputes when reactivating a paused job', () => {
    const now = new Date('2025-01-15T10:00:00');
    const next = resolveScheduledJobNextRunAt(existing, { status: 'active' }, now);
    expect(next).toBeDefined();
    expect(Date.parse(next!)).toBeGreaterThan(now.getTime());
  });

  it('recomputes when cron changes on an active job', () => {
    const active = { ...existing, status: 'active' };
    const now = new Date('2025-01-15T10:00:00');
    const next = resolveScheduledJobNextRunAt(active, { cronExpression: '0 10 * * *' }, now);
    expect(next).toBeDefined();
    expect(Date.parse(next!)).toBeGreaterThan(now.getTime());
  });

});

describe('SchedulerService', () => {
  let mockRepo: ApiRepository;
  let mockConversations: ConversationService;
  let mockRealtime: RealtimeService;
  let scheduler: SchedulerService;
  let members: Map<string, { id: string; organizationId: string }>;

  beforeEach(() => {
    members = new Map();
    mockRepo = {
      listDueJobsGlobally: vi.fn().mockReturnValue([]),
      saveScheduledJob: vi.fn(),
      getScheduledJob: vi.fn(),
      getChannel: vi.fn(),
      setChannelMembers: vi.fn(),
      setChannelMemberMode: vi.fn(),
      getChannelMemberMode: vi.fn().mockReturnValue(null),
      listChannelMemberModes: vi.fn().mockReturnValue([]),
      listChannelMemberModesForChannel: vi.fn().mockReturnValue([]),
      deleteChannelMemberMode: vi.fn(),
      getMember: vi.fn((organizationId: string, memberId: string) =>
        members.get(`${organizationId}:${memberId}`) ?? {
          id: memberId,
          organizationId,
          name: memberId === 'member-1' ? 'Alice' : 'Bob',
          kind: 'human',
          roleName: 'admin',
        }
      ),
      saveMember: vi.fn((member) => {
        members.set(`${member.organizationId}:${member.id}`, member);
        return member;
      }),
    } as unknown as ApiRepository;

    mockConversations = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      publishMessage: vi.fn().mockReturnValue(undefined),
    } as unknown as ConversationService;

    mockRealtime = {
      emit: vi.fn(),
    } as unknown as RealtimeService;

    scheduler = new SchedulerService(mockRepo, mockConversations, mockRealtime, {
      pollIntervalMs: 5000,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('executes due jobs and sends messages on behalf of the creator', async () => {
    const now = new Date().toISOString();
    const dueJob = {
      id: 'job-1',
      organizationId: 'org-1',
      name: 'Standup',
      cronExpression: '0 9 * * 1-5',
      prompt: 'Run standup',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      nextRunAt: now,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockRepo.listDueJobsGlobally = vi.fn().mockReturnValue([dueJob]);
    vi.mocked(mockRepo.getChannel).mockReturnValue({
      id: 'channel-1',
      organizationId: 'org-1',
      name: 'general',
      kind: 'general',
      topic: '',
      memberIds: ['member-1'],
    } as never);

    scheduler.start();

    await vi.waitFor(() => {
      expect(mockConversations.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          threadId: 'channel-1',
          channelId: 'channel-1',
          senderId: 'member-1',
          content: expect.stringContaining('Standup'),
        }),
      );
    }, { timeout: 2000 });
    expect(mockRealtime.emit).toHaveBeenCalledWith(
      SocketEventNames.scheduledJobExecuted,
      expect.objectContaining({
        organizationId: 'org-1',
        jobName: 'Standup',
        channelId: 'channel-1',
      }),
      [orgRoom('org-1'), channelRoom('channel-1')],
    );
    scheduler.stop();
  });

  it('handles job execution errors and advances nextRunAt', async () => {
    const runAt = new Date('2025-01-15T09:00:00');
    vi.useFakeTimers();
    vi.setSystemTime(runAt);

    const dueJob = {
      id: 'job-2',
      organizationId: 'org-1',
      name: 'Failing job',
      cronExpression: '0 9 * * *',
      prompt: 'Do something',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      nextRunAt: runAt.toISOString(),
      runCount: 0,
      createdAt: runAt.toISOString(),
      updatedAt: runAt.toISOString(),
    };
    let errorCalled = false;
    mockRepo.listDueJobsGlobally = vi.fn().mockImplementation(() => {
      if (errorCalled) return [];
      errorCalled = true;
      return [dueJob];
    });
    vi.mocked(mockRepo.getChannel).mockReturnValue({
      id: 'channel-1',
      organizationId: 'org-1',
      name: 'general',
      kind: 'general',
      topic: '',
      memberIds: ['member-1'],
    } as never);
    vi.mocked(mockConversations.sendMessage).mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(mockRepo.saveScheduledJob).toHaveBeenCalled();
    }, { timeout: 2000 });

    const saved = vi.mocked(mockRepo.saveScheduledJob).mock.calls.at(-1)?.[0];
    expect(saved?.lastError).toBe('send failed');
    expect(Date.parse(saved!.nextRunAt!)).toBeGreaterThan(runAt.getTime());

    scheduler.stop();
    vi.useRealTimers();
  });

  it('does not publish when the sender cannot write to the target channel', async () => {
    const now = new Date().toISOString();
    const dueJob = {
      id: 'job-private',
      organizationId: 'org-1',
      name: 'Private note',
      cronExpression: '0 9 * * *',
      prompt: 'Run private note',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      nextRunAt: now,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    let errorCalled = false;
    mockRepo.listDueJobsGlobally = vi.fn().mockImplementation(() => {
      if (errorCalled) return [];
      errorCalled = true;
      return [dueJob];
    });
    vi.mocked(mockRepo.getChannel).mockReturnValue({
      id: 'channel-1',
      organizationId: 'org-1',
      name: 'private',
      kind: 'dm',
      topic: '',
      memberIds: ['member-2'],
    } as never);
    vi.mocked(mockConversations.sendMessage).mockRejectedValueOnce(
      new Error('Forbidden: you do not have access to this thread'),
    );

    scheduler.start();

    await vi.waitFor(() => {
      expect(mockConversations.sendMessage).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });
    await vi.waitFor(() => {
      expect(mockRepo.saveScheduledJob).toHaveBeenCalled();
    }, { timeout: 2000 });

    const saved = vi.mocked(mockRepo.saveScheduledJob).mock.calls.at(-1)?.[0];
    expect(saved?.lastError).toBe('Forbidden: you do not have access to this thread');
    expect(mockConversations.publishMessage).not.toHaveBeenCalled();

    scheduler.stop();
  });

  it('does not throw from errors in listDueJobsGlobally', async () => {
    mockRepo.listDueJobsGlobally = vi.fn().mockImplementation(() => {
      throw new Error('DB error');
    });
    scheduler.start();

    await vi.waitFor(() => {
      expect(mockRepo.listDueJobsGlobally).toHaveBeenCalled();
    }, { timeout: 2000 });

    scheduler.stop();
  });
});
