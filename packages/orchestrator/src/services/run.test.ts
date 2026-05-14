import { describe, expect, it } from 'vitest';
import { loadAgentTeam } from '@ujima/framework';
import { AGENT_KIND } from '@ujima/shared';
import { RunService } from './run.js';
import { ToolApprovalRequiredError } from './tool-loop-result.js';

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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
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

  it('adds goal mode suffix from latest human in thread, not from a capped recent page', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    let capturedSuffix: string | undefined;
    const goalHuman = {
      id: 'human-buried',
      organizationId,
      threadId,
      senderId: 'human-1',
      senderKind: 'human',
      kind: 'human',
      content: 'Goal from earlier in thread',
      mentions: [],
      toolCalls: [],
      attachments: [],
      metadata: { goalMode: true },
      createdAt: '2026-05-04T19:07:01.071Z',
    };
    const repo = {
      getMember: () => ({
        id: agentId,
        organizationId,
        name: agentId,
        kind: AGENT_KIND,
        roleName: 'backend-engineer',
      }),
      saveRun: (next: any) => next,
      getRun: (orgId: string, id: string) =>
        orgId === organizationId && id === runId
          ? {
              id: runId,
              organizationId,
              agentId,
              threadId,
              status: 'queued',
              step: 'queued',
              summary: 'Run queued',
              startedAt: '2026-05-04T19:07:08.071Z',
            }
          : null,
      getProviderCredential: () => null,
      getWorkspaceSetting: () => null,
      listMembers: () => [],
      listPendingApprovals: () => [],
      listMessages: () => ({
        data: [
          {
            id: 'agent-reply-1',
            organizationId,
            threadId,
            senderId: agentId,
            senderKind: AGENT_KIND,
            kind: AGENT_KIND,
            content: 'Only agent lines on this page',
            mentions: [],
            toolCalls: [],
            attachments: [],
            createdAt: '2026-05-04T19:07:08.500Z',
          },
        ],
        hasMore: false,
      }),
      getLatestHumanMessageInThread: () => goalHuman,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;
    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/workspace' },
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
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async (input: { systemPromptSuffix?: string }) => {
          capturedSuffix = input.systemPromptSuffix;
          return { text: 'ok', toolResults: [], steps: [] };
        },
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    await (service as any).advanceRun({
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
    });

    expect(capturedSuffix).toContain('Goal Mode (Active)');
    expect(capturedSuffix).toContain('goal artifact file');
  });

  it('replays approved tools before the next turn when approval lands mid-run', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const pendingStep = {
      id: 'step-1',
      organizationId,
      runId,
      threadId,
      agentId,
      toolCallId: 'tool-call-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { cwd: '/workspace', command: 'echo hello' },
      output: { status: 'waiting_for_approval', approvalId: 'approval-1' },
      status: 'ok',
      createdAt: '2026-05-04T19:07:08.071Z',
    };
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
    };
    const calls: string[] = [];
    let generateCalls = 0;
    let resumeAfterApproval: (organizationId: string, runId: string) => Promise<unknown> =
      async () => undefined;
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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      listRunSteps: () => [pendingStep],
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;

    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/workspace' },
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
          generateCalls += 1;
          if (generateCalls === 1) {
            await resumeAfterApproval(organizationId, runId);
            throw new ToolApprovalRequiredError('approval-1');
          }
          return { text: 'Done.', toolResults: [], steps: [] };
        },
      } as never,
      {
        allowRun() {
          return undefined;
        },
        invoke: async (input: any) => {
          calls.push(input.toolCallId);
          return { ok: true, output: { status: 'completed' } };
        },
      } as never,
    );
    resumeAfterApproval = service.resumeAfterApproval.bind(service);

    const result = await (service as any).advanceRun(run);

    expect(calls).toEqual(['tool-call-1']);
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Done.');
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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
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

  it('executes the original pending tool call after approval before resuming the model', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const pendingStep = {
      id: 'step-1',
      organizationId,
      runId,
      threadId,
      agentId,
      toolCallId: 'tool-call-1',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      resourcePath: '/workspace',
      input: { cwd: '/workspace', command: 'echo hello' },
      output: { status: 'waiting_for_approval', approvalId: 'approval-1' },
      status: 'ok',
      createdAt: '2026-05-04T19:07:08.071Z',
    };
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
    let toolInvoked = false;
    let generateCalls = 0;

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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      listRunSteps: () => [pendingStep],
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;

    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/workspace' },
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
          expect(toolInvoked).toBe(true);
          return { text: 'Done.', toolResults: [], steps: [] };
        },
      } as never,
      {
        allowRun() {
          return undefined;
        },
        invoke: async (input: any) => {
          toolInvoked = true;
          expect(input.toolCallId).toBe('tool-call-1');
          expect(input.bypassPermission).toBe(true);
          return { ok: true, output: { status: 'completed' } };
        },
      } as never,
    );

    const result = await service.resumeAfterApproval(organizationId, runId, true);

    expect(result.status).toBe('completed');
    expect(toolInvoked).toBe(true);
    expect(generateCalls).toBe(1);
  });

  it('keeps processing pending approved tools after one fails and resumes the model', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const pendingSteps = [
      {
        id: 'step-1',
        organizationId,
        runId,
        threadId,
        agentId,
        toolCallId: 'tool-call-1',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '/workspace',
        input: { cwd: '/workspace', command: 'echo first' },
        output: { status: 'waiting_for_approval', approvalId: 'approval-1' },
        status: 'ok',
        createdAt: '2026-05-04T19:07:08.071Z',
      },
      {
        id: 'step-2',
        organizationId,
        runId,
        threadId,
        agentId,
        toolCallId: 'tool-call-2',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        resourcePath: '/workspace',
        input: { cwd: '/workspace', command: 'echo second' },
        output: { status: 'waiting_for_approval', approvalId: 'approval-2' },
        status: 'ok',
        createdAt: '2026-05-04T19:07:09.071Z',
      },
    ];
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
    const calls: string[] = [];
    let generateCalls = 0;
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
      listRunSteps: () => pendingSteps,
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;

    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/workspace' },
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
          generateCalls += 1;
          return { text: 'Done.', toolResults: [], steps: [] };
        },
      } as never,
      {
        allowRun() {
          return undefined;
        },
        invoke: async (input: any) => {
          calls.push(input.toolCallId);
          if (input.toolCallId === 'tool-call-1') {
            return { ok: false, error: 'first failed', output: { status: 'blocked', reason: 'first failed' } };
          }
          return { ok: true, output: { status: 'completed' } };
        },
      } as never,
    );

    const result = await service.resumeAfterApproval(organizationId, runId, true);

    expect(calls).toEqual(['tool-call-1', 'tool-call-2']);
    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Done.');
    expect(generateCalls).toBe(1);
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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
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

  it('does not publish a duplicate final assistant message when channel.dm tool ran', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: string[] = [];
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
    };
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
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
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
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: (message: any) => messages.push(message.content) } as never,
      {
        generateRunReply: async () => ({
          text: 'Acknowledged in prose.',
          toolResults: [{ toolName: 'channel.dm', output: { ok: true } }],
          steps: [],
        }),
      } as never,
      {
        allowRun: () => undefined,
        invoke: async () => ({ ok: true }),
      } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('Acknowledged in prose.');
    expect(messages).toEqual([]);
  });

  it('cancelRun marks an active run as cancelled and emits completion', () => {
    const organizationId = 'org-1';
    const runId = 'run-cancel-1';
    let run: any = {
      id: runId,
      organizationId,
      agentId: 'Quinn Mason',
      threadId: 'thread-1',
      status: 'running',
      step: 'running',
      summary: 'Busy',
      startedAt: '2026-05-04T19:07:08.071Z',
    };
    const repo = {
      getRun: () => run,
      saveRun: (next: any) => {
        run = next;
        return next;
      },
    } as never;
    let completions = 0;
    const service = new RunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/tmp' },
            roles: [{ name: 'backend-engineer', title: 'BE', instructions: '.', tools: ['shell'] }],
            agents: [{ name: 'Quinn Mason', roleName: 'backend-engineer' }],
          }),
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: () => { completions += 1; } } as never,
      {} as never,
      { generateRunReply: async () => ({ text: '', toolResults: [], steps: [] }) } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = service.cancelRun(organizationId, runId);
    expect(result.status).toBe('cancelled');
    expect(result.summary).toBe('Stopped by user');
    expect(completions).toBe(1);
    expect(service.cancelRun(organizationId, runId).status).toBe('cancelled');
  });
});
