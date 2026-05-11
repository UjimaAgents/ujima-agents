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
});
