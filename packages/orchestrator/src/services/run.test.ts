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
    // New behaviour (Phase 1 loophole-fix): when a terminating tool
    // already published the visible reply, the run records the tool
    // id as the summary (and as terminatingTool) rather than echoing
    // the model's prose. The thread is NOT re-published (messages
    // stays empty).
    expect(result.summary).toBe('channel.dm');
    expect(result.terminatingTool).toBe('channel.dm');
    expect(messages).toEqual([]);
  });

  it('completes a mention run when a persisted channel.reply already posted', async () => {
    const organizationId = 'org-1';
    const runId = 'run-persisted-reply-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const emitted: { event: string; payload: any }[] = [];
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
      wakeReason: 'mention',
      sourceMessageId: 'msg-trigger-1',
      byMemberId: 'human-1',
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
      listRunSteps: () => [
        {
          id: 'step-1',
          organizationId,
          runId,
          threadId,
          agentId,
          toolCallId: 'tool-call-1',
          toolId: 'channel.reply',
          action: 'message',
          resourceType: 'message',
          resourcePath: '',
          input: {},
          output: {},
          status: 'ok',
          createdAt: '2026-05-04T19:07:09.071Z',
        },
      ],
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
      { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as never,
      { publishMessage: (message: any) => messages.push(message.content) } as never,
      {
        generateRunReply: async () => ({
          text: '',
          toolResults: [],
          steps: [{ toolResults: [{ toolCallId: 'tool-call-1', output: {} }] }],
        }),
      } as never,
      {
        allowRun: () => undefined,
        invoke: async () => ({ ok: true }),
      } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('channel.reply');
    expect(result.terminatingTool).toBe('channel.reply');
    expect(messages).toEqual([]);
    expect(emitted.find((e) => e.event === 'member.must_reply_failed')).toBeUndefined();
  });

  // L12 — sycophantic pass: when the model calls channel.pass AND
  // also emits assistant prose, the runtime drops the prose, emits
  // agent.passed_with_text for audit, and completes silent.
  it('drops assistant text and emits agent.passed_with_text when channel.pass fires alongside prose (L12)', async () => {
    const organizationId = 'org-1';
    const runId = 'run-pass-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: string[] = [];
    const emitted: { event: string; payload: any }[] = [];
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
      wakeReason: 'channel-read',
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
      { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as never,
      { publishMessage: (message: any) => messages.push(message.content) } as never,
      {
        generateRunReply: async () => ({
          // Sycophantic: prose AND channel.pass.
          text: 'I think I should help here actually.',
          toolResults: [{ toolName: 'channel.pass', output: { status: 'passed', reason: 'not_addressed_to_me' } }],
          steps: [
            { toolCalls: [{ toolName: 'channel.pass', input: { reason: 'not_addressed_to_me' } }] },
          ],
        }),
      } as never,
      {
        allowRun: () => undefined,
        invoke: async () => ({ ok: true }),
      } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(result.terminatingTool).toBe('channel.pass');
    // Prose was dropped; channel got nothing.
    expect(messages).toEqual([]);
    // Audit event fired with the dropped text preserved.
    const audit = emitted.find((e) => e.event === 'agent:passed_with_text');
    expect(audit).toBeDefined();
    expect(audit?.payload.droppedText).toBe('I think I should help here actually.');
    // Silent-completion event also fired.
    expect(emitted.some((e) => e.event === 'run:silent_completion')).toBe(true);
  });

  // B2 + B3 — when a mention-wake run produces no text and no
  // terminating tool, auto-fail with `member.must_reply_failed`,
  // attribute to the persisted byMemberId (not run.agentId), and
  // skip the emit entirely if sourceMessageId is missing (which
  // would crash the schema parse).
  it('auto-fails on mandatory-reply violation, reads byMemberId from run row (B2/B3)', async () => {
    const organizationId = 'org-1';
    const runId = 'run-mention-fail-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const emitted: { event: string; payload: any }[] = [];
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
      wakeReason: 'mention',
      sourceMessageId: 'msg-trigger-1',
      byMemberId: 'human-1',
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
      { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async () => ({
          // Model produced nothing — neither a tool call nor text.
          text: '',
          toolResults: [],
          steps: [],
        }),
      } as never,
      {
        allowRun: () => undefined,
        invoke: async () => ({ ok: true }),
      } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('failed');
    const mustReply = emitted.find((e) => e.event === 'member.must_reply_failed');
    expect(mustReply).toBeDefined();
    // B2: byMemberId comes from the run row, NOT from run.agentId.
    expect(mustReply?.payload.byMemberId).toBe('human-1');
    // B3: messageId is the real sourceMessageId, not ''.
    expect(mustReply?.payload.messageId).toBe('msg-trigger-1');
  });

  it('skips must_reply_failed emit when sourceMessageId is missing (B3 schema guard)', async () => {
    const organizationId = 'org-1';
    const runId = 'run-mention-bad-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const emitted: { event: string; payload: any }[] = [];
    let run: any = {
      id: runId,
      organizationId,
      agentId,
      threadId,
      status: 'queued',
      step: 'queued',
      summary: 'Run queued',
      startedAt: '2026-05-04T19:07:08.071Z',
      wakeReason: 'mention',
      sourceMessageId: null, // Defensive: this should not crash.
      byMemberId: 'human-1',
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
              { name: 'backend-engineer', title: 'Backend', instructions: '.', tools: ['shell'] },
            ],
            agents: [{ name: agentId, roleName: 'backend-engineer' }],
          }),
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: (event: string, payload: any) => emitted.push({ event, payload }) } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async () => ({ text: '', toolResults: [], steps: [] }),
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await (service as any).advanceRun(run);

    // Still fails the run (mandatory-reply violation), but the emit
    // is skipped because messageId would have been empty and schema
    // would throw.
    expect(result.status).toBe('failed');
    expect(emitted.find((e) => e.event === 'member.must_reply_failed')).toBeUndefined();
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
