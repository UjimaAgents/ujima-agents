import { describe, expect, it, vi } from 'vitest';
import type { ApiRepository } from '../services/repository-reader.js';
import { scheduleTool } from './schedule.js';

describe('scheduleTool', () => {
  it('creates, lists, and cancels schedules', async () => {
    const repo = {
      getThread: vi.fn().mockReturnValue({ channelId: 'channel-1' }),
      saveScheduledJob: vi.fn((job) => job),
      listScheduledJobs: vi.fn().mockReturnValue([{ id: 'job-1' }]),
      getScheduledJob: vi.fn().mockReturnValue({ id: 'job-1' }),
      deleteScheduledJob: vi.fn(),
    } as unknown as ApiRepository;

    const create = await scheduleTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'member-1',
        threadId: 'thread-1',
        toolCallId: 'tool-1',
        toolId: 'schedule',
        action: 'execute',
        resourceType: 'message',
        input: {
          action: 'create',
          cron_expression: '0 9 * * *',
          prompt: 'Standup',
        },
      },
      repo,
      team: {} as never,
      conversations: {} as never,
    });

    expect((create as { job: { name: string; channelId?: string } }).job.name).toBe('Standup');
    expect((create as { job: { name: string; channelId?: string } }).job.channelId).toBe('channel-1');
    expect(repo.saveScheduledJob).toHaveBeenCalled();

    const listed = await scheduleTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'member-1',
        toolCallId: 'tool-2',
        toolId: 'schedule',
        action: 'read',
        resourceType: 'message',
        input: { action: 'list' },
      },
      repo,
      team: {} as never,
      conversations: {} as never,
    });
    expect(listed).toEqual({ jobs: [{ id: 'job-1' }] });

    const cancelled = await scheduleTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'member-1',
        toolCallId: 'tool-3',
        toolId: 'schedule',
        action: 'execute',
        resourceType: 'message',
        input: { action: 'cancel', job_id: 'job-1' },
      },
      repo,
      team: {} as never,
      conversations: {} as never,
    });
    expect(cancelled).toEqual({ removed: true, job: { id: 'job-1' } });
    expect(repo.deleteScheduledJob).toHaveBeenCalledWith('org-1', 'job-1');
  });
});
