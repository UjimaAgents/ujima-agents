import type { ApprovalRequest } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export function pendingApprovalSummary(approval: ApprovalRequest | undefined): string {
  if (!approval) return 'Waiting for approval';
  const target = approval.resourcePath ? ` ${approval.resourcePath}` : '';
  return `Waiting for approval: ${approval.action}${target}`;
}

export function pendingApprovalRunSummary(
  repo: Pick<ApiRepository, 'listPendingApprovals'>,
  organizationId: string,
  runId: string | undefined,
): string {
  const approval = runId
    ? repo.listPendingApprovals(organizationId).find((item) => item.runId === runId)
    : undefined;
  return pendingApprovalSummary(approval);
}
