import {
  type GovernancePolicy,
  type RiskDefaults,
  removePlatformRule,
  setPlatformRule,
  setRiskDefaults,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

/** Per-tool decision the settings UI can set. `inherit` clears any rule. */
export type ToolRuleState = 'allow' | 'require_approval' | 'deny' | 'inherit';

export class GovernanceService {
  constructor(private readonly repo: ApiRepository) {}

  get(organizationId: string): GovernancePolicy {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error('Organization not found');
    }
    return this.repo.getGovernancePolicy(organizationId);
  }

  updateRiskDefaults(
    organizationId: string,
    next: Partial<RiskDefaults>,
  ): GovernancePolicy {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error('Organization not found');
    }
    const current = this.repo.getGovernancePolicy(organizationId);
    const updated = setRiskDefaults(current, next);
    return this.repo.saveGovernancePolicy(organizationId, updated);
  }

  /**
   * Set the org-wide decision for a single (mcp, tool) pair from the
   * settings UI. Writes into the workspace-settings policy blob the gate
   * actually evaluates — NOT the legacy `governance_rules` table, which
   * the daemon never reads. `tool_name` may carry a trailing `*` to cover
   * a family (e.g. `browser_*`).
   *
   * A tool lives in at most one platform bucket, so we strip it from all
   * three first, then place it in the bucket for the chosen state.
   */
  setToolRule(
    organizationId: string,
    input: { mcpId: string; toolName: string; state: ToolRuleState; reason?: string },
  ): GovernancePolicy {
    if (!this.repo.getOrganization(organizationId)) {
      throw new Error('Organization not found');
    }
    const { mcpId, toolName, state, reason } = input;
    let policy = this.repo.getGovernancePolicy(organizationId);
    for (const bucket of ['always_allow', 'always_deny', 'default_require_approval'] as const) {
      policy = removePlatformRule(policy, bucket, mcpId, toolName);
    }
    if (state !== 'inherit') {
      const bucket =
        state === 'allow'
          ? 'always_allow'
          : state === 'deny'
            ? 'always_deny'
            : 'default_require_approval';
      policy = setPlatformRule(policy, bucket, {
        mcp_id: mcpId,
        tool_name: toolName,
        state: state === 'allow' ? 'allow' : state === 'deny' ? 'deny' : 'require_approval',
        reason,
        updated_by: 'human',
        updated_at: new Date().toISOString(),
      });
    }
    return this.repo.saveGovernancePolicy(organizationId, policy);
  }
}
