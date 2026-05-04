import { describe, expect, it } from 'vitest';
import { loadAgentTeam } from '@ujima/framework';
import { AGENT_KIND } from '@ujima/shared';
import { RunService } from './run.js';

describe('RunService', () => {
  it('resumes after approval even when approval resolves before the run enters waiting state', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: string[] = [];
    let run: any = null;
    let generateCalls = 0;
    let resumeAfterApproval: (organizationId: string, runId: string) => Promise<unknown> =
      async () => undefined;
    let team = loadAgentTeam({
      name: 'Timetotest',
      workspace: { root: '/Users/mac/Documents/Work/Timetotest' },
      roles: [
        {
          name: 'backend-engineer',
          title: 'Backend Engineer',
          instructions: 'Work on backend.',
          tools: ['shell'],
        },
      ],
      agents: [{ name: agentId, roleName: 'backend-engineer' }],
    });

    const repo = {
      getMember: () => ({
        id: agentId,
        organizationId,
        name: agentId,
        kind: AGENT_KIND,
        roleName: 'backend-engineer',
      }),
      saveRun: (next: any) => {
        run = next;
        return next;
      },
      getRun: () => run,
      getProviderCredential: () => null,
      getWorkspaceSetting: () => null,
      listMembers: () => [],
      listPendingApprovals: () => [],
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;
    const tools = {
      allowRun: () => undefined,
      invoke: async () => ({ ok: true }),
    };
    const ai = {
      generateRunReply: async () => {
        generateCalls++;
        if (generateCalls === 1) {
          await resumeAfterApproval(organizationId, runId);
          return { text: 'This requires approval to run.', toolResults: [], steps: [] };
        }
        return { text: 'Here are the last 10 backend commits.', toolResults: [], steps: [] };
      },
    };

    const service = new RunService(
      {
        getTeam: () => team,
        setTeam: (next: typeof team) => {
          team = next;
        },
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: (message: any) => messages.push(message.content) } as never,
      ai as never,
      tools as never,
    );
    resumeAfterApproval = service.resumeAfterApproval.bind(service);

    run = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
    };

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Here are the last 10 backend commits.');
    expect(messages).toEqual(['Here are the last 10 backend commits.']);
    expect(generateCalls).toBe(2);
  });
});
