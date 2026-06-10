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

  it('does not reuse a pending approval from a different requesting agent', () => {
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

    let saved: ApprovalRequest | undefined;
    let emitted = 0;
    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: (value: ApprovalRequest) => {
        saved = value;
        return value;
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
      toolCallId: 'tool-2',
      requestedBy: 'agent-2',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      reason: `Tool action requires approval;scope=${encodeURIComponent(shellScope)}`,
      approvalScope: shellScope,
    });

    expect(result.id).not.toBe('ap-1');
    expect(result.requestedBy).toBe('agent-2');
    expect(saved?.requestedBy).toBe('agent-2');
    expect(emitted).toBe(1);
  });

  it('reuses a pending write approval when only the file content changes', () => {
    const oldScope = 'write:{"resourcePath":"/workspace/readme.md","content":"old"}';
    const nextScope = 'edit:{"file_path":"/workspace/readme.md","old_string":"old","new_string":"new"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/workspace/readme.md',
      action: 'write',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(oldScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let saved = 0;
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
      { emit: () => undefined } as never,
      () => undefined,
    );

    const result = service.requestApproval({
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-2',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/workspace/readme.md',
      action: 'write',
      reason: `Tool action requires approval;scope=${encodeURIComponent(nextScope)}`,
      approvalScope: nextScope,
    });

    expect(result.id).toBe('ap-1');
    expect(saved).toBe(0);
  });

  it('does not reuse a pending download approval for a different source URL', () => {
    const oldScope = 'download:{"resourcePath":"/tmp/report.csv","url":"https://one.example/report.csv"}';
    const nextScope = 'download:{"resourcePath":"/tmp/report.csv","url":"https://two.example/report.csv"}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/tmp/report.csv',
      action: 'write',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(oldScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let saved = 0;
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
      { emit: () => undefined } as never,
      () => undefined,
    );

    const result = service.requestApproval({
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-2',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/tmp/report.csv',
      action: 'write',
      reason: `Tool action requires approval;scope=${encodeURIComponent(nextScope)}`,
      approvalScope: nextScope,
    });

    expect(result.id).not.toBe('ap-1');
    expect(saved).toBe(1);
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
    expect(emitted).toBe(2);
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

  it('resumes an allow_always approval with the persisted scope', async () => {
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
    let resumedScope: string | undefined;
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
      async (_organizationId: string, _runId: string, _allowRun?: boolean, approvalScope?: string) => {
        resumedScope = approvalScope;
        return undefined;
      },
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
    expect(resumedScope).toBe(shellScope);
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
      `grant:always_allow_family:scope=${encodeURIComponent('shell:{"cwd":"/workspace","command":"git"}')};note=Always allow this git family.`,
    );
  });

  it('persists an allow_always grant even when the approval reason lacks scope', async () => {
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/workspace/readme.md',
      action: 'write',
      status: 'pending',
      reason: 'Tool action requires approval',
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
      () => undefined,
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_always',
      reason: 'Allow this write permanently.',
    });

    expect(result.status).toBe('approved');
    expect(capturedReason).toBe(
      `grant:always_allow:scope=${encodeURIComponent(
        'filesystem:{"action":"write","resourcePath":"/workspace/readme.md"}',
      )};note=Allow this write permanently.`,
    );
  });

  it('approves pending shell calls in the same run when allow_family matches their command family', async () => {
    const gitDiffScope = 'shell:{"cwd":"/workspace","command":"git","args":["diff"]}';
    const gitStatusScope = 'shell:{"cwd":"/workspace","command":"git","args":["status"]}';
    const npmTestScope = 'shell:{"cwd":"/workspace","command":"npm","args":["test"]}';
    const baseApproval = {
      organizationId: 'org-1',
      runId: 'run-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    } as const;
    const approvals = [
      {
        ...baseApproval,
        id: 'ap-1',
        toolCallId: 'tool-1',
        reason: `Tool action requires approval;scope=${encodeURIComponent(gitDiffScope)}`,
      },
      {
        ...baseApproval,
        id: 'ap-2',
        toolCallId: 'tool-2',
        reason: `Tool action requires approval;scope=${encodeURIComponent(gitStatusScope)}`,
      },
      {
        ...baseApproval,
        id: 'ap-3',
        toolCallId: 'tool-3',
        reason: `Tool action requires approval;scope=${encodeURIComponent(npmTestScope)}`,
      },
    ];
    const resolvedIds: string[] = [];
    const repo = {
      listPendingApprovals: () => approvals,
      saveApproval: () => approvals[0],
      listMembers: () => [],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: () => approvals[0],
      resolveApproval: (_orgId: string, approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        const approval = approvals.find((item) => item.id === approvalId);
        if (!approval) return null;
        resolvedIds.push(approvalId);
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
      () => undefined,
    );

    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_family',
      reason: 'Always allow this git family.',
    });

    expect(resolvedIds).toEqual(['ap-1', 'ap-2']);
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

  it('PR 11 — attachment_request resolver also fires on rejection', async () => {
    // The attachment_request_resolved audit row should land on BOTH
    // approve and reject paths so operators can grep the full
    // discovery lifecycle. The resolver gets the same payload shape;
    // the `approved` flag tells it whether to write the attachment
    // row or just emit the audit.
    const payload = {
      serverId: 'srv_censys',
      target: 'channel' as const,
      targetId: 'ch_investigations',
      agentReason: 'why not',
      approvalId: 'ap-attach-r',
    };
    const encoded = encodeURIComponent(JSON.stringify(payload));
    const original = {
      id: 'ap-attach-r',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'mem_snoop',
      resourceType: 'mcp',
      resourcePath: 'attachment_request:srv_censys:channel:ch_investigations',
      action: 'mcp',
      status: 'pending',
      reason: `attachment_request_scope=${encoded}`,
      createdAt: '2026-06-10T00:00:00.000Z',
      resolvedAt: undefined,
    } satisfies ApprovalRequest;
    const resolvedRow = { ...original, status: 'rejected' as const };
    const repo = {
      listPendingApprovals: () => [original],
      saveApproval: () => original,
      getRun: () => null,
      getApproval: () => original,
      resolveApproval: () => resolvedRow,
      deleteApproval: () => undefined,
    } as never;
    const calls: { approved: boolean; target: string }[] = [];
    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      () => undefined,
    );
    service.setAttachmentApprovalResolver((input) => {
      calls.push({ approved: input.approved, target: input.payload.target });
    });
    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-attach-r',
      status: 'rejected',
      reason: 'not now',
    });
    expect(calls).toEqual([{ approved: false, target: 'channel' }]);
  });

  it('PR 11 (bot fix) — rejecting an attachment_request does NOT fan out to unrelated MCP approvals on the same run', async () => {
    // Bot Round 2 finding: requestAttachmentApproval reuses
    // resourceType='mcp' / action='mcp', which puts attachment_request
    // rows in the same shape as normal connector invocation approvals.
    // The standard reject path fans out by runId — rejecting one MCP
    // approval cascades to every other pending MCP approval on the
    // run. Without a discriminator, rejecting an attachment_request
    // would also reject any pending invoke_connector_tool approvals
    // on the same run, which is wrong: attachment decisions are
    // independent.
    //
    // The fix narrows the fanout: when `existing.reason` starts with
    // the attachment_request_scope prefix, the reject fanout is
    // suppressed and only the attachment_request row is resolved.
    // Sibling MCP invocation approvals stay pending.
    const attachmentPayload = {
      serverId: 'srv_censys',
      serverDisplayName: 'Censys',
      target: 'agent' as const,
      targetId: 'mem_snoop',
      agentReason: 'why',
      approvalId: 'ap-attach',
    };
    const attachmentReason = `attachment_request_scope=${encodeURIComponent(
      JSON.stringify(attachmentPayload),
    )}`;
    const attachmentRow: ApprovalRequest = {
      id: 'ap-attach',
      organizationId: 'org-1',
      runId: 'run-shared',
      toolCallId: 'tc-attach',
      requestedBy: 'mem_snoop',
      resourceType: 'mcp',
      resourcePath: 'attachment_request:srv_censys:agent:mem_snoop',
      action: 'mcp',
      status: 'pending',
      reason: attachmentReason,
      createdAt: '2026-06-10T00:00:00.000Z',
      resolvedAt: undefined,
    };
    const siblingInvocation: ApprovalRequest = {
      id: 'ap-invoke',
      organizationId: 'org-1',
      runId: 'run-shared',
      toolCallId: 'tc-invoke',
      requestedBy: 'mem_snoop',
      resourceType: 'mcp',
      resourcePath: 'srv_ddg:search',
      action: 'mcp',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(
        'connector:{"serverId":"srv_ddg","toolName":"search","args":{}}',
      )}`,
      createdAt: '2026-06-10T00:00:00.000Z',
      resolvedAt: undefined,
    };
    // On rejection the path goes through deleteApproval (the
    // resolved row is built locally via ApprovalRequestSchema.parse,
    // so resolveApproval isn't invoked). We track deleteApproval
    // calls instead — those are the rows the fanout actually
    // tears down.
    const deleted = new Set<string>();
    const repo = {
      listPendingApprovals: () => [attachmentRow, siblingInvocation],
      saveApproval: () => attachmentRow,
      getRun: () => ({ id: 'run-shared', threadId: 'thread-1' }),
      getApproval: (_org: string, id: string) =>
        id === 'ap-attach' ? attachmentRow : siblingInvocation,
      resolveApproval: () => attachmentRow,
      deleteApproval: (_org: string, id: string) => {
        deleted.add(id);
      },
    } as never;
    const service = new ApprovalService(
      repo,
      { emit: () => undefined } as never,
      () => undefined,
    );

    await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-attach',
      status: 'rejected',
      reason: 'not now',
    });

    // ONLY the attachment_request row is torn down. The sibling
    // MCP invocation approval on the same run stays pending —
    // pre-fix this set would have contained both ids because the
    // runId fanout would have swept the sibling in too.
    expect(deleted).toEqual(new Set(['ap-attach']));
  });
});
