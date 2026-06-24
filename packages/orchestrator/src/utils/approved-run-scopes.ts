import { canonicalizeApprovalGrantScope } from '@ujima/shared';

/**
 * Tracks one-shot approval consumption for a run: scoped (per tool scope) or whole-run.
 */
export class ApprovedRunScopeTracker {
  private readonly approvedRuns = new Set<string>();
  private readonly approvedRunScopes = new Set<string>();

  allowRun(organizationId: string, runId: string, approvalScope?: string): void {
    if (approvalScope) {
      this.approvedRunScopes.add(
        this.scopedRunKey(organizationId, runId, canonicalizeApprovalGrantScope(approvalScope)),
      );
      return;
    }
    this.approvedRuns.add(this.runKey(organizationId, runId));
  }

  hasApprovedRun(organizationId: string, runId: string, approvalScope: string): boolean {
    const scopedKey = this.scopedRunKey(
      organizationId,
      runId,
      canonicalizeApprovalGrantScope(approvalScope),
    );
    if (this.approvedRunScopes.has(scopedKey)) return true;
    const key = this.runKey(organizationId, runId);
    return this.approvedRuns.has(key);
  }

  consumeApprovedRun(organizationId: string, runId: string, approvalScope: string): boolean {
    const scopedKey = this.scopedRunKey(
      organizationId,
      runId,
      canonicalizeApprovalGrantScope(approvalScope),
    );
    if (this.approvedRunScopes.has(scopedKey)) {
      this.approvedRunScopes.delete(scopedKey);
      return true;
    }
    const key = this.runKey(organizationId, runId);
    if (!this.approvedRuns.has(key)) {
      return false;
    }
    this.approvedRuns.delete(key);
    return true;
  }

  private runKey(organizationId: string, runId: string): string {
    return `${organizationId}:${runId}`;
  }

  private scopedRunKey(organizationId: string, runId: string, approvalScope: string): string {
    return `${this.runKey(organizationId, runId)}:${approvalScope}`;
  }
}
