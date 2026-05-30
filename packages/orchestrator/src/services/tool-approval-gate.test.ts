import { describe, expect, it } from 'vitest';
import { ApprovedRunScopeTracker } from '../utils/approved-run-scopes.js';
import { isToolApprovalSatisfied } from './tool-approval-gate.js';
import type { ApiRepository } from './repository-reader.js';

describe('isToolApprovalSatisfied', () => {
  const approvedRunScopes = new ApprovedRunScopeTracker();
  const repo = {
    hasApprovalGrant: () => false,
  } as unknown as ApiRepository;

  it('returns true when policy does not require approval', () => {
    expect(
      isToolApprovalSatisfied({
        policy: { allowed: true, requiresApproval: false },
        organizationId: 'org',
        runId: 'run',
        approvalScope: 'shell:{}',
        approvedRunScopes,
        repo,
        invocation: {
          organizationId: 'org',
          runId: 'run',
          memberId: 'agent',
          toolCallId: 'tc',
          toolId: 'shell',
          action: 'execute',
          resourceType: 'shell',
        },
      }),
    ).toBe(true);
  });

  it('returns true after allowRun consumes the scope', () => {
    const scopes = new ApprovedRunScopeTracker();
    scopes.allowRun('org', 'run', 'shell:{"command":"ls"}');
    expect(
      isToolApprovalSatisfied({
        policy: { allowed: true, requiresApproval: true, shellAutoReview: true },
        organizationId: 'org',
        runId: 'run',
        approvalScope: 'shell:{"command":"ls"}',
        approvedRunScopes: scopes,
        repo,
        invocation: {
          organizationId: 'org',
          runId: 'run',
          memberId: 'agent',
          toolCallId: 'tc',
          toolId: 'shell',
          action: 'execute',
          resourceType: 'shell',
        },
      }),
    ).toBe(true);
  });
});
