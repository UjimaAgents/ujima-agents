import { describe, expect, it } from 'vitest';
import {
  peekBackgroundJob,
  terminateBackgroundJob,
  shellTool,
} from './shell.js';

const unixDescribe = process.platform === 'win32' ? describe.skip : describe;

describe('shellTool', () => {
  it('executes single-string commands with shell parsing when args are absent', async () => {
    const result = await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: { command: 'printf "ok"' },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(result).toEqual({ stdout: 'ok', stderr: '' });
  });

  it('executes explicit argument arrays without shell wrapping', async () => {
    const result = await shellTool.execute({
      invocation: {
        organizationId: 'org-1',
        runId: 'run-1',
        memberId: 'agent-1',
        toolCallId: 'tool-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: {
          command: 'sh',
          args: ['-c', 'printf "%s" "$1"', '_', 'feature/foo'],
        },
      },
      team: { workspace: { root: process.cwd() } } as never,
      repo: {} as never,
      conversations: {} as never,
    });

    expect(result).toEqual({ stdout: 'feature/foo', stderr: '' });
  });
});

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
    });

    const race = await Promise.race([
      waitPromise.then(() => 'resolved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 150)),
    ]);

    expect(race).toBe('pending');

    const snapshot = (await waitPromise) as { status: string; stdout: string };
    expect(snapshot.status).toBe('exited');
    expect(snapshot.stdout).toBe('ready');
  });
});
