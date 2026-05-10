import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@ujima/shared';
import { ApprovalService } from './approval.js';

describe('ApprovalService', () => {
  it('relays a new approval to the owner chat', () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"pwd"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let saved = 0;
    let emitted = 0;
    let relayThreadId: string | undefined;
    let relayContent: string | undefined;
    let savedPayload: ApprovalRequest | undefined;
    const repo = {
      listPendingApprovals: () => [],
      saveApproval: (value: ApprovalRequest) => {
        savedPayload = value;
        saved++;
        return value;
      },
      listMembers: () => [
        { id: 'owner-1', organizationId: 'org-1', kind: 'human', roleName: 'owner', name: 'Owner' },
        { id: 'agent-1', organizationId: 'org-1', kind: 'agent', roleName: 'qa', name: 'Ava' },
      ],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: () => approval,
      resolveApproval: () => approval,
    } as never;
    const conversations = {
      sendDirectMessage: (input: {
        organizationId: string;
        senderId: string;
        recipientId: string;
        content: string;
      }) => {
        relayThreadId = `dm:${[input.senderId, input.recipientId].sort().join(':')}`;
        relayContent = input.content;
        return {
          id: 'relay-message-1',
          organizationId: input.organizationId,
          threadId: relayThreadId,
          channelId: relayThreadId,
          senderId: input.senderId,
          senderKind: 'agent',
          kind: 'agent',
          content: input.content,
          mentions: [],
          createdAt: '2026-05-04T00:00:00.000Z',
        };
      },
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      conversations,
      () => undefined,
    );

    const result = service.requestApproval({
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      approvalScope: shellScope,
    });

    expect(result.status).toBe('pending');
    expect(saved).toBe(1);
    expect(savedPayload?.threadId).toBe('thread-1');
    expect(emitted).toBe(2);
    expect(relayThreadId).toBe('dm:agent-1:owner-1');
    expect(relayContent).toBe('```\n/workspace\n$ pwd\n```');
  });

  it('reuses a pending approval for the same shell scope', () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"pwd"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let saved = 0;
    let emitted = 0;
    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: () => {
        saved++;
        return approval;
      },
      listMembers: () => [],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: () => approval,
      resolveApproval: () => approval,
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      { sendDirectMessage: () => undefined } as never,
      () => undefined,
    );

    const result = service.requestApproval({
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      approvalScope: shellScope,
    });

    expect(result.id).toBe('ap-1');
    expect(saved).toBe(0);
    expect(emitted).toBe(0);
  });

  it('resolves duplicate pending approvals for the same scope together', async () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"pwd"}';
    interface ApprovalFixture {
      id: string;
      organizationId: string;
      runId: string;
      toolCallId: string;
      requestedBy: string;
      resourceType: string;
      resourcePath: string;
      action: string;
      status: 'pending' | 'approved' | 'rejected';
      reason: string;
      createdAt: string;
      resolvedAt: string | undefined;
    }
    const pendingOne: ApprovalFixture = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };
    const pendingTwo = { ...pendingOne, id: 'ap-2', createdAt: '2026-05-04T00:00:01.000Z' };
    const approvals = new Map<string, ApprovalFixture>([
      [pendingOne.id, pendingOne],
      [pendingTwo.id, pendingTwo],
    ]);
    let resumed = 0;
    let emitted = 0;
    const repo = {
      listPendingApprovals: () => [...approvals.values()].filter((approval) => approval.status === 'pending'),
      saveApproval: () => pendingOne,
      listMembers: () => [
        { id: 'owner-1', organizationId: 'org-1', kind: 'human', roleName: 'owner', name: 'Owner' },
      ],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: (_orgId: string, approvalId: string) => approvals.get(approvalId) ?? null,
      resolveApproval: (_orgId: string, approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        const current = approvals.get(approvalId);
        if (!current) return null;
        const resolved: ApprovalFixture = {
          ...current,
          status,
          reason: reason ?? '',
          resolvedAt: '2026-05-04T00:01:00.000Z',
        };
        approvals.set(approvalId, resolved);
        return resolved;
      },
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      { sendDirectMessage: () => undefined } as never,
      () => { resumed++; },
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_once',
      reason: 'Resolved from workspace (allow_once).',
    });

    expect(result.status).toBe('approved');
    expect([...approvals.values()].every((approval) => approval.status === 'approved')).toBe(true);
    expect(emitted).toBe(4);
    expect(resumed).toBe(1);
  });

  it('stops a run on rejection and passes allowRun=false', async () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"git log --oneline -10"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };
    const run = {
      id: 'run-1',
      organizationId: 'org-1',
      threadId: 'thread-1',
      status: 'waiting_for_approval',
      step: 'waiting_for_approval',
      summary: 'Waiting for approval',
      startedAt: '2026-05-04T00:00:00.000Z',
    };
    let emitted = 0;
    let resumedAllowRun: boolean | undefined;
    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: () => approval,
      listMembers: () => [
        { id: 'owner-1', organizationId: 'org-1', kind: 'human', roleName: 'owner', name: 'Owner' },
      ],
      getRun: () => run,
      getApproval: () => approval,
      resolveApproval: (_orgId: string, _approvalId: string, status: 'approved' | 'rejected', reason?: string) => ({
        ...approval,
        status,
        reason: reason ?? '',
        resolvedAt: '2026-05-04T00:01:00.000Z',
      }),
      deleteApproval: () => undefined,
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      { sendDirectMessage: () => undefined } as never,
      async (_organizationId: string, _runId: string, allowRun?: boolean) => {
        resumedAllowRun = allowRun;
        if (allowRun === false) {
          run.status = 'failed';
          run.step = 'failed';
          run.summary = 'Approval rejected by user';
        }
        return run;
      },
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'rejected',
      resolution: 'reject',
      reason: 'Not approved.',
    });

    expect(result.status).toBe('rejected');
    expect(resumedAllowRun).toBe(false);
    expect(run.status).toBe('failed');
    expect(run.summary).toBe('Approval rejected by user');
    expect(emitted).toBe(3);
  });

  it('persists an allow_always grant with the encoded scope reason', async () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"pwd"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };
    let capturedReason = '';
    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: () => approval,
      listMembers: () => [],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: () => approval,
      resolveApproval: (_orgId: string, _approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        capturedReason = reason ?? '';
        return {
          ...approval,
          status,
          reason: reason ?? '',
          resolvedAt: '2026-05-04T00:01:00.000Z',
        };
      },
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      { sendDirectMessage: () => undefined } as never,
      () => undefined,
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_always',
      reason: 'Always allow this exact command.',
    });

    expect(result.status).toBe('approved');
    expect(capturedReason).toBe(
      `grant:always_allow:scope=${encodeURIComponent(shellScope)};note=Always allow this exact command.`,
    );
  });

  it('persists an allow_family grant without args', async () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"git","args":["diff"]}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };
    let capturedReason = '';
    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: () => approval,
      listMembers: () => [],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: () => approval,
      resolveApproval: (_orgId: string, _approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        capturedReason = reason ?? '';
        return {
          ...approval,
          status,
          reason: reason ?? '',
          resolvedAt: '2026-05-04T00:01:00.000Z',
        };
      },
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      { sendDirectMessage: () => undefined } as never,
      () => undefined,
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_family',
      reason: 'Always allow this git family.',
    });

    expect(result.status).toBe('approved');
    expect(capturedReason).toBe(
      `grant:always_allow:scope=${encodeURIComponent('shell:{"cwd":"/workspace","command":"git"}')};note=Always allow this git family.`,
    );
  });
});
