
import { describe, expect, it } from 'vitest';
import { loadAgentTeam } from '@ujima/framework';
import { AGENT_KIND, SocketEventNames, type RunChunkEvent, type RunState } from '@ujima/shared';
import { SpiritService } from './spirit.js';
import { ToolApprovalRequiredError } from './tool-loop-result.js';

function expectRunState(result: RunState | unknown): asserts result is RunState {
  if (!result || typeof result !== 'object' || !('startedAt' in result) || !('status' in result)) {
    throw new Error('expected a RunState result');
  }
}

function createSpiritRunService(
  teamStore: ConstructorParameters<typeof SpiritService>[0],
  repo: ConstructorParameters<typeof SpiritService>[1],
  realtime: ConstructorParameters<typeof SpiritService>[2],
  conversations: NonNullable<ConstructorParameters<typeof SpiritService>[4]>['conversations'],
  ai: NonNullable<ConstructorParameters<typeof SpiritService>[4]>['ai'],
  tools: ConstructorParameters<typeof SpiritService>[3],
) {
  const service = new SpiritService(teamStore, repo, realtime, tools, { conversations, ai });
  if (ai?.generateRunReply) {
    service.generateRunReply = ai.generateRunReply as typeof service.generateRunReply;
  }
  return service;
}

describe('SpiritService run path', () => {
  it('emits one running start event for a new run', async () => {
    const organizationId = 'org-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    let run: RunState | null = null;
    const emitted: { event: string; payload: { run?: RunState } }[] = [];
    const team = loadAgentTeam({
      name: 'Timetotest',
      workspace: { root: '/workspace' },
      roles: [{
        name: 'backend-engineer',
        title: 'Backend Engineer',
        instructions: 'Work on backend.',
        tools: [],
      }],
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
      saveRun: (next: RunState) => {
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
    const service = createSpiritRunService(
      { getTeam: () => team, setTeam: () => undefined } as never,
      repo,
      { emit: (event: string, payload: { run?: RunState }) => emitted.push({ event, payload }) } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async () => ({
          text: 'Done.',
          toolResults: [],
          steps: [],
        }),
      } as never,
      { invoke: async () => ({ ok: true }) } as never,
    );

    await service.createRun({ organizationId, agentId, threadId });

    const starts = emitted.filter((entry) => entry.event === SocketEventNames.runStarted);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.payload.run?.status).toBe('running');
    expect(emitted.filter((entry) => entry.event === SocketEventNames.runUpdated)).toHaveLength(0);
  });

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

    const service = createSpiritRunService(
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

  it('persists token counts to the final reply silently (no realtime re-broadcast)', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: any[] = [];
    const updatedMessages: any[] = [];
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
      listRunSteps: () => [],
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
      updateMessage: (message: any) => {
        updatedMessages.push(message);
        return message;
      },
    } as never;

    const service = createSpiritRunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/tmp' },
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
      {
        publishMessage: (message: any) => {
          messages.push(message);
          return message;
        },
      } as never,
      {
        generateRunReply: async () => ({
          text: "Got it. Feature's done.",
          usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
          toolResults: [],
          steps: [{ text: '' }],
        }),
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Got it. Feature's done.");
    // The realtime emit went out token-free — the live counter under
    // the typing indicator owns that visualization. Tokens are
    // persisted silently to the DB so they survive a reload.
    expect(messages[0].inputTokens).toBeUndefined();
    expect(messages[0].outputTokens).toBeUndefined();
    expect(updatedMessages).toHaveLength(1);
    expect(updatedMessages[0].inputTokens).toBe(12);
    expect(updatedMessages[0].outputTokens).toBe(34);
  });

  it('streams agent chunks to realtime while the run is still executing', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const emits: { event: string; payload: unknown }[] = [];
    let run: RunState = {
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
      saveRun: (next: RunState) => {
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

    const service = createSpiritRunService(
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
      { emit: (event: string, payload: unknown) => emits.push({ event, payload }) } as never,
      { publishMessage: () => undefined } as never,
      {
        generateRunReply: async (input: {
          onChunk?: (chunk: { kind: 'text' | 'reasoning'; delta: string }) => PromiseLike<void> | void;
        }) => {
          await input.onChunk?.({ kind: 'reasoning', delta: 'Thinking…' });
          await input.onChunk?.({ kind: 'text', delta: 'Hello' });
          return { text: 'Hello', toolResults: [], steps: [] };
        },
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(
      emits.some(({ event, payload }) => {
        if (event !== SocketEventNames.runChunk) return false;
        const chunk = payload as RunChunkEvent;
        return chunk.kind === 'reasoning' && chunk.delta === 'Thinking…';
      }),
    ).toBe(true);
    expect(
      emits.some(({ event, payload }) => {
        if (event !== SocketEventNames.runChunk) return false;
        const chunk = payload as RunChunkEvent;
        return chunk.kind === 'text' && chunk.delta === 'Hello';
      }),
    ).toBe(true);
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
    let replayedStep = pendingStep;
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
      listRunSteps: () => [replayedStep],
      saveRunStep: (step: any) => {
        replayedStep = step;
        return step;
      },
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;

    const service = createSpiritRunService(
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
    let replayedStep = pendingStep;

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
      listRunSteps: () => [replayedStep],
      saveRunStep: (step: any) => {
        replayedStep = step;
        return step;
      },
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;

    const service = createSpiritRunService(
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

    expectRunState(result);
    expect(result.status).toBe('completed');
    expect(toolInvoked).toBe(true);
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

    const service = createSpiritRunService(
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

  it('emits failed run state when rejecting approval for an active spirit', async () => {
    const organizationId = 'org-1';
    const runId = 'run-1';
    const agentId = 'agent-1';
    const now = '2026-05-04T19:07:08.071Z';
    let run: RunState = {
      id: runId,
      organizationId,
      agentId,
      threadId: 'thread-1',
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary: 'Waiting for approval',
      startedAt: now,
    };
    let spirit: any = {
      id: 'spirit-1',
      organizationId,
      taskSessionId: 'session-1',
      memberId: agentId,
      role: 'worker',
      runId,
      status: 'waiting_for_approval',
      createdAt: now,
      updatedAt: now,
    };
    const emitted: { event: string; payload: { run?: RunState } }[] = [];
    const service = createSpiritRunService(
      { getTeam: () => null, setTeam: () => undefined } as never,
      {
        getSpiritByRunId: () => spirit,
        getSpirit: () => spirit,
        saveSpirit: (next: any) => {
          spirit = next;
          return next;
        },
        getRun: () => run,
        saveRun: (next: RunState) => {
          run = next;
          return next;
        },
        getThread: () => ({ channelId: 'channel-1' }),
        listMembers: () => [],
      } as never,
      { emit: (event: string, payload: { run?: RunState }) => emitted.push({ event, payload }) } as never,
      { publishMessage: () => undefined } as never,
      { generateRunReply: async () => ({ text: '', toolResults: [], steps: [] }) } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await service.resumeAfterApproval(organizationId, runId, false);

    expect((result as { status?: string } | null)?.status).toBe('failed');
    const terminal = emitted.find((entry) => entry.event === SocketEventNames.runCompleted);
    expect(terminal?.payload.run?.status).toBe('failed');
    expect(terminal?.payload.run?.summary).toBe('Approval rejected by user');
  });

  it('persists blocked-run trace without failing the run', async () => {
    const organizationId = 'org-1';
    const runId = 'run-blocked-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: any[] = [];
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
      listRunSteps: () => [],
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;
    const service = createSpiritRunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/Users/mac/Documents/Work/Timetotest' },
            roles: [{ name: 'backend-engineer', title: 'Backend Engineer', instructions: 'Work.', tools: ['view'] }],
            agents: [{ name: agentId, roleName: 'backend-engineer' }],
          }),
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: (message: any) => messages.push(message) } as never,
      {
        generateRunReply: async () => ({
          text: 'I checked the file before the block.',
          reasoningText: 'Need the file context before editing.',
          toolResults: [],
          steps: [
            {
              text: 'I checked the file before the block.',
              reasoningText: 'Need the file context before editing.',
              toolCalls: [{ toolCallId: 'tool-call-1', toolName: 'view', input: { path: 'src/index.ts' } }],
              toolResults: [{ toolCallId: 'tool-call-1', output: { status: 'blocked', code: 'blocked_tool' } }],
            },
          ],
        }),
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('completed');
    expect(result.summary).toBe('I checked the file before the block.');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('I checked the file before the block.');
    expect(messages[0].reasoningContent).toBe('Need the file context before editing.');
    expect(messages[0].toolCalls[0].toolName).toBe('view');
    expect(messages[0].metadata).toEqual({ runId, runProgress: true });
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
      listRunSteps: () => [
        {
          id: 'step-pass-1',
          organizationId,
          runId,
          threadId,
          agentId,
          toolCallId: 'tool-call-pass-1',
          toolId: 'channel.pass',
          action: 'message',
          resourceType: 'message',
          resourcePath: '',
          input: { reason: 'not_addressed_to_me' },
          output: { status: 'passed', reason: 'not_addressed_to_me' },
          status: 'ok',
          createdAt: '2026-05-04T19:07:09.071Z',
        },
      ],
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;
    const service = createSpiritRunService(
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
        generateRunReply: async (input: any) => {
          const textAfterPassStep = { text: 'channel.pass accepted — I was not addressed.' };
          await input.onStepFinish?.(textAfterPassStep, [textAfterPassStep]);
          return {
            // Sycophantic: prose after a persisted channel.pass.
            text: textAfterPassStep.text,
            toolResults: [],
            steps: [textAfterPassStep],
          };
        },
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
    expect(audit?.payload.droppedText).toBe('channel.pass accepted — I was not addressed.');
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
    const service = createSpiritRunService(
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
    const questions: any[] = [
      {
        id: 'question-cancel-1',
        organizationId,
        channelId: 'channel-1',
        runId,
        questionText: 'Pick one',
        options: ['Yes (Recommended)', 'No'],
        status: 'pending',
        createdAt: '2026-05-04T19:07:08.071Z',
        updatedAt: '2026-05-04T19:07:08.071Z',
      },
    ];
    let approval: any = {
      id: 'approval-cancel-1',
      organizationId,
      runId,
      toolCallId: 'tool-1',
      requestedBy: 'Quinn Mason',
      resourceType: 'shell',
      resourcePath: '/tmp',
      action: 'execute',
      status: 'pending',
      reason: 'needs approval',
      createdAt: '2026-05-04T19:07:08.071Z',
    };
    const repo = {
      getRun: () => run,
      saveRun: (next: any) => {
        run = next;
        return next;
      },
      getThread: () => ({ channelId: 'channel-1' }),
      listPendingApprovals: () => (approval.status === 'pending' ? [approval] : []),
      resolveApproval: (_organizationId: string, approvalId: string, status: string, reason?: string) => {
        if (approvalId !== approval.id) return null;
        approval = {
          ...approval,
          status,
          reason,
          resolvedAt: '2026-05-04T19:08:08.071Z',
        };
        return approval;
      },
      listInteractiveQuestionsByRunId: () => questions,
      saveInteractiveQuestion: (next: any) => {
        const index = questions.findIndex((question) => question.id === next.id);
        if (index >= 0) questions[index] = next;
        return next;
      },
    } as never;
    const emitted: string[] = [];
    const service = createSpiritRunService(
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
      { emit: (event: string) => { emitted.push(event); } } as never,
      {} as never,
      { generateRunReply: async () => ({ text: '', toolResults: [], steps: [] }) } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = service.cancelRun(organizationId, runId);
    expect(result.status).toBe('cancelled');
    expect(result.summary).toBe('Stopped by user');
    expect(questions[0].status).toBe('superseded');
    expect(approval.status).toBe('rejected');
    expect(approval.reason).toBe('Run cancelled by user.');
    expect(emitted).toContain('run:completed');
    expect(emitted).toContain('approval:resolved');
    expect(service.cancelRun(organizationId, runId).status).toBe('cancelled');
  });

  it('persists streamed trace when a run is stopped', async () => {
    const organizationId = 'org-1';
    const runId = 'run-stop-trace-1';
    const agentId = 'Quinn Mason';
    const threadId = 'thread-1';
    const messages: any[] = [];
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
      getRun: () => run,
      saveRun: (next: any) => {
        run = next;
        return next;
      },
      getProviderCredential: () => null,
      getWorkspaceSetting: () => null,
      listMembers: () => [],
      listPendingApprovals: () => [],
      listMessages: () => ({ data: [], hasMore: false }),
      getLatestHumanMessageInThread: () => null,
      getSpiritByRunId: () => null,
      getThread: () => ({ channelId: 'channel-1' }),
    } as never;
    const service = createSpiritRunService(
      {
        getTeam: () =>
          loadAgentTeam({
            name: 'Timetotest',
            workspace: { root: '/tmp' },
            roles: [{ name: 'backend-engineer', title: 'BE', instructions: '.', tools: ['shell'] }],
            agents: [{ name: agentId, roleName: 'backend-engineer' }],
          }),
        setTeam: () => undefined,
      } as never,
      repo,
      { emit: () => undefined } as never,
      { publishMessage: (message: any) => messages.push(message) } as never,
      {
        generateRunReply: async (input: { onChunk?: (chunk: { kind: 'text' | 'reasoning'; delta: string }) => void }) => {
          input.onChunk?.({ kind: 'reasoning', delta: 'Checking the component tree.' });
          input.onChunk?.({ kind: 'text', delta: 'I changed the skeleton primitive.' });
          service.cancelRun(organizationId, runId);
          return { text: '', toolResults: [], steps: [] };
        },
      } as never,
      { allowRun: () => undefined, invoke: async () => ({ ok: true }) } as never,
    );

    const result = await (service as any).advanceRun(run);

    expect(result.status).toBe('cancelled');
    expect(messages[0].content).toBe('I changed the skeleton primitive.');
    expect(messages[0].reasoningContent).toBe('Checking the component tree.');
    expect(messages[0].metadata).toMatchObject({ runId, stoppedTrace: true });
  });
});
