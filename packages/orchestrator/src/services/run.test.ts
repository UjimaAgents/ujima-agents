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

  it('fails a waiting run immediately when approval is rejected', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary: 'Waiting for approval',
      startedAt: '2026-05-04T19:07:08.071Z',
    };
    let generateCalls = 0;
    let allowRunCalls = 0;
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
    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
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
          }),
        setTeam() {
          return undefined;
        },
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async () => {
          generateCalls++;
          return { text: 'should not be reached', toolResults: [], steps: [] };
        },
      } as never,
      {
        allowRun() {
          allowRunCalls++;
        },
        invoke: async () => ({ ok: true }),
      } as never,
    );

    const result = await service.resumeAfterApproval(organizationId, runId, false);

    expect(result.status).toBe('failed');
    expect(result.summary).toBe('Approval rejected by user');
    expect(run.status).toBe('failed');
    expect(generateCalls).toBe(0);
    expect(allowRunCalls).toBe(0);
  });

  it('fails a running run on rejection before the next advance', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: string[] = [];
    let run: any = null;
    let generateCalls = 0;
    let resumeAfterApproval: (organizationId: string, runId: string, allowRun?: boolean) => Promise<unknown> =
      async () => undefined;
    const team = loadAgentTeam({
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
      allowRun() {
        return undefined;
      },
      invoke: async () => ({ ok: true }),
    };
    const ai = {
      generateRunReply: async () => {
        generateCalls++;
        if (generateCalls === 1) {
          await resumeAfterApproval(organizationId, runId, false);
          return { text: 'Approval rejected by user.', toolResults: [], steps: [] };
        }
        return { text: 'This should never run.', toolResults: [], steps: [] };
      },
    };

    const service = new RunService(
      {
        getTeam: () => team,
        setTeam: () => undefined,
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

    expect(result.status).toBe('failed');
    expect(result.summary).toBe('Approval rejected by user');
    expect(run.status).toBe('failed');
    expect(messages).toEqual([]);
    expect(generateCalls).toBe(1);
  });
});
