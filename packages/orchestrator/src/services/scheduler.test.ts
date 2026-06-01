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

  it('matches exact minute and advances when not matched', () => {
    const matcher = parseCronExpression('30 * * * *');
    expect(matcher).not.toBeNull();
    expect(matcher!(new Date('2025-01-15T10:30:00'))).not.toBeNull();
    const next = matcher!(new Date('2025-01-15T10:31:00'));
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(30);
    expect(next!.getHours()).toBe(11);
  });

  it('matches exact hour+minute, advances to next occurrence', () => {
    const matcher = parseCronExpression('0 9 * * *');
    expect(matcher).not.toBeNull();
    expect(matcher!(new Date('2025-01-15T09:00:00'))).not.toBeNull();
    const next = matcher!(new Date('2025-01-15T09:01:00'));
    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(16);
    expect(next!.getHours()).toBe(9);
    expect(next!.getMinutes()).toBe(0);
  });

  it('matches day-of-week ranges correctly', () => {
    const matcher = parseCronExpression('0 9 * * 1-5');
    expect(matcher).not.toBeNull();
    const monday = new Date('2025-01-13T09:00:00');
    expect(matcher!(monday)).not.toBeNull();
    const saturday = new Date('2025-01-11T09:00:00');
    const next = matcher!(saturday);
    expect(next).not.toBeNull();
    expect(next!.getDay()).toBeGreaterThanOrEqual(1);
    expect(next!.getDay()).toBeLessThanOrEqual(5);
  });

  it('matches comma-separated lists, advances to next', () => {
    const matcher = parseCronExpression('0,30 * * * *');
    expect(matcher).not.toBeNull();
    expect(matcher!(new Date('2025-01-15T10:00:00'))).not.toBeNull();
    expect(matcher!(new Date('2025-01-15T10:30:00'))).not.toBeNull();
    const next = matcher!(new Date('2025-01-15T10:15:00'));
    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(30);
  });

  it('advances to next day when no match in current day', () => {
    const matcher = parseCronExpression('0 9 * * *');
    const from = new Date('2025-01-15T08:30:00');
    const result = matcher!(from);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it('returns null for non-numeric values in field', () => {
    expect(parseCronExpression('abc * * * *')).toBeNull();
    expect(parseCronExpression('* * * * abc')).toBeNull();
  });

  it('accepts value 60 (never matches but valid integer)', () => {
    const matcher = parseCronExpression('60 * * * *');
    expect(matcher).not.toBeNull();
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

  it('returns null for invalid cron expressions', () => {
    expect(computeNextCronRun('not-a-cron')).toBeNull();
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

  it('keeps nextRunAt when pausing without cron change', () => {
    const active = { ...existing, status: 'active', nextRunAt: '2025-06-01T09:00:00.000Z' };
    const next = resolveScheduledJobNextRunAt(active, { status: 'paused' }, new Date());
    expect(next).toBe(active.nextRunAt);
  });

  it('recomputes when cron changes on an active job', () => {
    const active = { ...existing, status: 'active' };
    const now = new Date('2025-01-15T10:00:00');
    const next = resolveScheduledJobNextRunAt(active, { cronExpression: '0 10 * * *' }, now);
    expect(next).toBeDefined();
    expect(Date.parse(next!)).toBeGreaterThan(now.getTime());
  });

  it('returns undefined for an invalid cron change', () => {
    const active = { ...existing, status: 'active' };
    expect(resolveScheduledJobNextRunAt(active, { cronExpression: 'not-a-cron' }, new Date())).toBeUndefined();
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

  it('starts and stops the polling loop', () => {
    scheduler.start();
    scheduler.stop();
  });

  it('advances nextRunAt strictly after a successful run', async () => {
    const runAt = new Date('2025-01-15T09:00:00');
    vi.useFakeTimers();
    vi.setSystemTime(runAt);

    const dueJob = {
      id: 'job-advance',
      organizationId: 'org-1',
      name: 'Daily',
      cronExpression: '0 9 * * *',
      prompt: 'Run daily',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      nextRunAt: runAt.toISOString(),
      runCount: 0,
      createdAt: runAt.toISOString(),
      updatedAt: runAt.toISOString(),
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
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => {
      expect(mockRepo.saveScheduledJob).toHaveBeenCalled();
    }, { timeout: 2000 });

    const saved = vi.mocked(mockRepo.saveScheduledJob).mock.calls.at(-1)?.[0];
    expect(saved?.runCount).toBe(1);
    expect(Date.parse(saved!.nextRunAt!)).toBeGreaterThan(runAt.getTime());

    scheduler.stop();
    vi.useRealTimers();
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

  it('does not overlap ticks while a job is still running', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T09:00:00'));

    let resolveSend!: () => void;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    vi.mocked(mockConversations.sendMessage).mockImplementation(
      (() => sendPromise) as unknown as ConversationService['sendMessage'],
    );

    const dueJob = {
      id: 'job-overlap',
      organizationId: 'org-1',
      name: 'Overlap',
      cronExpression: '0 9 * * *',
      prompt: 'Hold the line',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      nextRunAt: new Date('2025-01-15T09:00:00').toISOString(),
      runCount: 0,
      createdAt: new Date('2025-01-15T09:00:00').toISOString(),
      updatedAt: new Date('2025-01-15T09:00:00').toISOString(),
    };
    let overlapCalled = false;
    mockRepo.listDueJobsGlobally = vi.fn().mockImplementation(() => {
      if (overlapCalled) return [];
      overlapCalled = true;
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

    scheduler = new SchedulerService(mockRepo, mockConversations, mockRealtime, {
      pollIntervalMs: 5,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => {
      expect(mockConversations.sendMessage).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });

    await vi.advanceTimersByTimeAsync(50);
    expect(mockConversations.sendMessage).toHaveBeenCalledTimes(1);

    resolveSend();
    await vi.waitFor(() => {
      expect(mockRepo.saveScheduledJob).toHaveBeenCalledTimes(1);
    }, { timeout: 2000 });

    scheduler.stop();
    vi.useRealTimers();
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
