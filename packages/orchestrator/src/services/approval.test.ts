import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@ujima/shared';
import { ApprovalService } from './approval.js';

describe('ApprovalService', () => {
  it('persists pending approval and emits socket event', () => {
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

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
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
    expect(emitted).toBe(1);
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

  it('does not reuse same-scope approvals across runs', () => {
    const shellScope = 'shell:{"cwd":"/workspace","command":"pwd"}';
    const oldApproval = {
      id: 'ap-old',
      organizationId: 'org-1',
      runId: 'run-old',
      toolCallId: 'tool-old',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let savedPayload: ApprovalRequest | undefined;
    let emitted = 0;
    const repo = {
      listPendingApprovals: () => [oldApproval],
      saveApproval: (value: ApprovalRequest) => {
        savedPayload = value;
        return value;
      },
      listMembers: () => [],
      getRun: () => ({ threadId: 'thread-new' }),
      getApproval: () => oldApproval,
      resolveApproval: () => oldApproval,
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      () => undefined,
    );

    const result = service.requestApproval({
      organizationId: 'org-1',
      runId: 'run-new',
      toolCallId: 'tool-new',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      approvalScope: shellScope,
    });

    expect(result.id).not.toBe('ap-old');
    expect(result.runId).toBe('run-new');
    expect(savedPayload?.toolCallId).toBe('tool-new');
    expect(emitted).toBe(1);
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
    expect(emitted).toBe(1);
  });

  it('PR 11 — attachment_request payload survives reason overwrite and reaches the resolver', async () => {
    // Bot finding: requestAttachmentApproval encodes the §17.5.6
    // payload as `attachment_request_scope=<json>` in the reason,
    // but resolveApproval overwrites `reason` with the operator's
    // note (or a `grant:...`/`reject:...` prefix) BEFORE handing
    // the row to the attachment resolver. Reading `resolved.reason`
    // would always come up null, so the wired resolver would never
    // run and approved attach-requests would silently drop the row.
    //
    // The fix sources the payload from `existing.reason` instead.
    // This test pins both halves: the resolver is called exactly
    // once per resolveApproval, and the payload matches what
    // requestAttachmentApproval wrote.
    const payload = {
      serverId: 'srv_censys',
      target: 'agent' as const,
      targetId: 'mem_snoop',
      agentReason: 'Need SSL cert history for example.com',
      approvalId: 'ap-attach-1',
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const original = {
      id: 'ap-attach-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      threadId: 'thread-1',
      requestedBy: 'mem_snoop',
      resourceType: 'mcp',
      resourcePath: 'attachment_request:srv_censys:agent:mem_snoop',
      action: 'mcp',
      status: 'pending',
      reason: `attachment_request_scope=${encoded}`,
      createdAt: '2026-06-10T00:00:00.000Z',
      resolvedAt: undefined,
    } satisfies ApprovalRequest;

    const resolvedRow = { ...original, status: 'approved' as const };
    const repo = {
      listPendingApprovals: () => [original],
      saveApproval: () => original,
      getRun: () => ({ id: 'run-1', threadId: 'thread-1' }),
      getApproval: () => original,
      resolveApproval: () => resolvedRow,
      deleteApproval: () => undefined,
    } as never;

    const resolverCalls: {
      approvalId: string;
      approved: boolean;
      payload: { serverId: string; target: string; targetId: string };
    }[] = [];
    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      () => undefined,
    );
    service.setAttachmentApprovalResolver((input) => {
      resolverCalls.push({
        approvalId: input.approvalId,
        approved: input.approved,
        payload: {
          serverId: input.payload.serverId,
          target: input.payload.target,
          targetId: input.payload.targetId,
        },
      });
    });

    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-attach-1',
      status: 'approved',
      resolution: 'allow_once',
      reason: 'Looks fine — go ahead',
    });

    // The resolver must fire exactly once with the payload sourced
    // from the ORIGINAL pending row's reason (not the rewritten
    // resolved row).
    expect(resolverCalls).toHaveLength(1);
    expect(resolverCalls[0]).toMatchObject({
      approvalId: 'ap-attach-1',
      approved: true,
      payload: {
        serverId: 'srv_censys',
        target: 'agent',
        targetId: 'mem_snoop',
      },
    });
  });

  it('tracks allow_once, allow_always, and allow_family scope behavior', async () => {
    const statusScope = 'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const logScope = 'shell:{"cwd":"/workspace","command":"git","args":["log"]}';
    const makeApproval = (id: string, scope: string) => ({
      id,
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: `tool-${id}`,
      requestedBy: 'agent-1',
      resourceType: 'shell' as const,
      resourcePath: '/workspace',
      action: 'execute' as const,
      status: 'pending' as const,
      reason: `Tool action requires approval;scope=${encodeURIComponent(scope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    });

    const run = { id: 'run-1', threadId: 'thread-1', status: 'waiting_for_approval' };
    const approvals = [makeApproval('ap-status', statusScope), makeApproval('ap-log', logScope)];
    const resolvedIds: string[] = [];
    let resumeScope: string | undefined;
    const repo = {
      listPendingApprovals: () => approvals.filter((a) => a.status === 'pending'),
      getRun: () => run,
      getApproval: (_orgId: string, approvalId: string) => approvals.find((a) => a.id === approvalId),
      resolveApproval: (_orgId: string, approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        const approval = approvals.find((a) => a.id === approvalId)!;
        resolvedIds.push(approvalId);
        Object.assign(approval, { status, reason: reason ?? approval.reason, resolvedAt: '2026-05-04T00:01:00.000Z' });
        return approval;
      },
      deleteApproval: () => undefined,
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      (_organizationId, _runId, _allowRun, approvalScope) => {
        resumeScope = approvalScope;
      },
    );

    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-status',
      status: 'approved',
      resolution: 'allow_once',
    });
    expect(resolvedIds).toEqual(['ap-status']);
    expect(resumeScope).toBe(statusScope);

    approvals[0] = makeApproval('ap-status', statusScope);
    approvals[1] = makeApproval('ap-log', logScope);
    resolvedIds.length = 0;
    resumeScope = undefined;
    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-status',
      status: 'approved',
      resolution: 'allow_always',
    });
    expect(resolvedIds).toEqual(['ap-status']);
    expect(approvals[0]?.reason).toBe('grant:always_allow:scope=shell%3A%7B%22cwd%22%3A%22%2Fworkspace%22%2C%22command%22%3A%22git%22%2C%22args%22%3A%5B%22status%22%5D%7D;note=');

    approvals[0] = makeApproval('ap-status', statusScope);
    approvals[1] = makeApproval('ap-log', logScope);
    resolvedIds.length = 0;
    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-status',
      status: 'approved',
      resolution: 'allow_family',
    });
    expect(resolvedIds).toEqual(['ap-status', 'ap-log']);
    expect(approvals[0]?.reason).toBe('grant:always_allow_family:scope=shell%3A%7B%22cwd%22%3A%22%2Fworkspace%22%2C%22command%22%3A%22git%22%7D;note=');
    expect(approvals[1]?.reason).toBe('grant:always_allow_family:scope=shell%3A%7B%22cwd%22%3A%22%2Fworkspace%22%2C%22command%22%3A%22git%22%7D;note=');
  });

});
