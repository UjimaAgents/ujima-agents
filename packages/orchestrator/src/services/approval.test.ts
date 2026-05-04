import { describe, expect, it } from 'vitest';
import { ApprovalService } from './approval.js';

describe('ApprovalService', () => {
  it('reuses a pending approval for the same shell scope', () => {
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: 'Tool action requires approval;scope=shell%3A%2Fworkspace%3Apwd%3A%5B%5D',
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
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      reason: 'Tool action requires approval;scope=shell%3A%2Fworkspace%3Apwd%3A%5B%5D',
      approvalScope: 'shell:/workspace:pwd:[]',
    });

    expect(result.id).toBe('ap-1');
    expect(saved).toBe(0);
    expect(emitted).toBe(0);
  });

  it('resolves duplicate pending approvals for the same scope together', async () => {
    const pendingOne = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/workspace',
      action: 'execute',
      status: 'pending',
      reason: 'Tool action requires approval;scope=shell%3A%2Fworkspace%3Apwd%3A%5B%5D',
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };
    const pendingTwo = { ...pendingOne, id: 'ap-2', createdAt: '2026-05-04T00:00:01.000Z' };
    const approvals = new Map<string, any>([
      [pendingOne.id, pendingOne],
      [pendingTwo.id, pendingTwo],
    ]);
    let resumed = 0;
    let emitted = 0;
    const repo = {
      listPendingApprovals: () => [...approvals.values()].filter((approval) => approval.status === 'pending'),
      saveApproval: () => pendingOne,
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: (_orgId: string, approvalId: string) => approvals.get(approvalId) ?? null,
      resolveApproval: (_orgId: string, approvalId: string, status: 'approved' | 'rejected', reason?: string) => {
        const current = approvals.get(approvalId);
        if (!current) return null;
        const resolved = {
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
});
