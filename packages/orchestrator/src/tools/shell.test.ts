import { describe, expect, it } from 'vitest';
import {
  listBackgroundJobs,
  peekBackgroundJob,
  terminateBackgroundJob,
  shellTool,
} from './shell.js';

const unixDescribe = process.platform === 'win32' ? describe.skip : describe;

unixDescribe('shellTool background termination', () => {
  it('keeps the job registered after terminate until the process exits', async () => {
    const runId = `run-bg-${Math.random().toString(36).slice(2)}`;
    const execResult = (await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId,
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '/',
        input: {
          command: 'sleep',
          args: ['30'],
          cwd: process.cwd(),
          background: true,
        },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as { job_id: string };

    const { job_id: jobId } = execResult;
    expect(peekBackgroundJob(runId, jobId)?.status).toBe('running');

    expect(terminateBackgroundJob(runId, jobId)).toBe(true);
    expect(peekBackgroundJob(runId, jobId)).not.toBeNull();
  });

  it('waits for the job to exit instead of returning on first output', async () => {
    const runId = `run-wait-${Math.random().toString(36).slice(2)}`;
    const execResult = (await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId,
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '/',
        input: {
          command: 'sh',
          args: ['-c', 'printf ready; sleep 1'],
          cwd: process.cwd(),
          background: true,
        },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as { job_id: string };

    const waitPromise = shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId,
        memberId: 'agent-1',
        toolCallId: 'tool-2',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: {
          operation: 'wait',
          job_id: execResult.job_id,
        },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    }) as Promise<{ status: string; stdout: string }>;

    const race = await Promise.race<string>([
      waitPromise.then(() => 'resolved'),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 150)),
    ]);

    expect(race).toBe('pending');

    const snapshot = await waitPromise;
    expect(snapshot.status).toBe('exited');
    expect(snapshot.stdout).toBe('ready');
  });

  it('lists command metadata and keeps output after read_output', async () => {
    const runId = `run-list-${Math.random().toString(36).slice(2)}`;
    const execResult = (await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId,
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: process.cwd(),
        input: {
          command: 'sh',
          args: ['-c', 'printf visible; sleep 1'],
          cwd: process.cwd(),
          background: true,
        },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    })) as { job_id: string };

    const listed = listBackgroundJobs(runId).find((job) => job.id === execResult.job_id);
    expect(listed).toMatchObject({ cwd: process.cwd(), commandLine: 'sh -c printf visible; sleep 1' });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId,
        memberId: 'agent-1',
        toolCallId: 'tool-2',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: { operation: 'read_output', job_id: execResult.job_id },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(peekBackgroundJob(runId, execResult.job_id)?.stdout).toContain('visible');
    terminateBackgroundJob(runId, execResult.job_id);
  });
});
