import type { PolicyResult } from './policy.js';
import type { ApiRepository } from './repository-reader.js';
import type { ApprovedRunScopeTracker } from '../utils/approved-run-scopes.js';
import type { ToolInvocationInput } from './tool-service.js';

export function isToolApprovalSatisfied(input: {
  policy: PolicyResult;
  organizationId: string;
  runId: string;
  approvalScope: string;
  approvedRunScopes: ApprovedRunScopeTracker;
  repo: ApiRepository;
  invocation: ToolInvocationInput;
}): boolean {
  if (!input.policy.requiresApproval) return true;
  if (
    input.approvedRunScopes.consumeApprovedRun(
      input.organizationId,
      input.runId,
      input.approvalScope,
    )
  ) {
    return true;
  }
  return input.repo.hasApprovalGrant({
    organizationId: input.invocation.organizationId,
    resourceType: input.invocation.resourceType,
    action: input.invocation.action,
    approvalScope: input.approvalScope,
  });
}
