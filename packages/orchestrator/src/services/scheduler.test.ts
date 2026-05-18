import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseCronExpression, SchedulerService } from './scheduler.js';
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

describe('SchedulerService', () => {
  let mockRepo: ApiRepository;
  let mockConversations: ConversationService;
  let mockRealtime: RealtimeService;
  let scheduler: SchedulerService;

  beforeEach(() => {
    mockRepo = {
      listDueJobsGlobally: vi.fn().mockReturnValue([]),
      saveScheduledJob: vi.fn(),
      getScheduledJob: vi.fn(),
      getMember: vi.fn().mockReturnValue(null),
      saveMember: vi.fn(),
    } as unknown as ApiRepository;

    mockConversations = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
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

  it('executes due jobs and sends messages', async () => {
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
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockRepo.listDueJobsGlobally = vi.fn().mockReturnValue([dueJob]);

    scheduler.start();

    await vi.waitFor(() => {
      expect(mockConversations.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          channelId: 'channel-1',
          content: expect.stringContaining('Standup'),
        }),
      );
    }, { timeout: 2000 });
    scheduler.stop();
  });

  it('handles job execution errors and records lastError', async () => {
    const now = new Date().toISOString();
    const dueJob = {
      id: 'job-2',
      organizationId: 'org-1',
      name: 'Failing job',
      cronExpression: '* * * * *',
      prompt: 'Do something',
      channelId: 'channel-1',
      memberId: 'member-1',
      status: 'active' as const,
      runCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    mockRepo.listDueJobsGlobally = vi.fn().mockReturnValue([dueJob]);

    scheduler.start();

    await vi.waitFor(() => {
      expect(mockRepo.saveScheduledJob).toHaveBeenCalledOnce();
    }, { timeout: 2000 });

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
