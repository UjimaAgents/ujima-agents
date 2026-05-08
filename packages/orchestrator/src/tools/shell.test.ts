import { describe, expect, it } from 'vitest';
import { shellTool } from './shell.js';

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
