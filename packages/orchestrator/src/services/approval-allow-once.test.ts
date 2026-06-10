import { describe, expect, it } from 'vitest';
import { canonicalizeApprovalGrantScope } from '@ujima/shared';
import { ApprovalService } from './approval.js';

describe('ApprovalService allow_once regression', () => {
  it('resumes with the canonical grant scope instead of the display scope', async () => {
    const displayScope = 'edit:{"resourcePath":"/x/a.md","oldString":"old","newString":"new","startLine":2}';
    const approval = {
      id: 'ap-1',
      organizationId: 'org-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      requestedBy: 'agent-1',
      resourceType: 'file',
      resourcePath: '/x/a.md',
      action: 'write',
      status: 'pending',
      reason: `Tool action requires approval;scope=${encodeURIComponent(displayScope)}`,
      createdAt: '2026-05-04T00:00:00.000Z',
      resolvedAt: undefined,
    };

    let emitted = 0;
    let resumedAllowRun: boolean | undefined;
    let resumedScope: string | undefined;

    const repo = {
      listPendingApprovals: () => [approval],
      saveApproval: () => approval,
      listMembers: () => [{ id: 'owner-1', organizationId: 'org-1', kind: 'human', roleName: 'owner', name: 'Owner' }],
      getRun: () => ({ threadId: 'thread-1' }),
      getApproval: (_orgId: string, approvalId: string) => (approvalId === approval.id ? approval : null),
      resolveApproval: (_orgId: string, _approvalId: string, status: 'approved' | 'rejected', reason?: string) => ({
        ...approval,
        status,
        reason: reason ?? '',
        resolvedAt: '2026-05-04T00:01:00.000Z',
      }),
    } as never;

    const service = new ApprovalService(
      repo,
      { emit: () => { emitted++; } } as never,
      async (_organizationId: string, _runId: string, allowRun?: boolean, approvalScope?: string) => {
        resumedAllowRun = allowRun;
        resumedScope = approvalScope;
      },
    );

    const result = await service.resolveApproval({
      organizationId: 'org-1',
      approvalId: 'ap-1',
      status: 'approved',
      resolution: 'allow_once',
      reason: 'Resolved from workspace (allow_once).',
    });

    expect(result.status).toBe('approved');
    expect(emitted).toBe(1);
    expect(resumedAllowRun).toBe(true);
    expect(resumedScope).toBe(canonicalizeApprovalGrantScope(displayScope));
    expect(resumedScope).not.toContain('startLine');
  });
});
