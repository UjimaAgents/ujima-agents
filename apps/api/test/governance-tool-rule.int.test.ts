import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OrganizationSchema, evaluatePolicy } from '@ujima/shared';
import { GovernanceService } from '@ujima/orchestrator';

// Locks the settings-UI per-tool decision path: GovernanceService.setToolRule
// must write into the workspace-settings policy blob that the gate's
// getGovernancePolicy reads (NOT the legacy governance_rules table the
// daemon never consults), and the written rule must change evaluatePolicy.

function makeService() {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const org = OrganizationSchema.parse({
    id: 'org-1',
    name: 'Org 1',
    workspace: { root: '/tmp/org-1', roleScopes: {} },
  });
  repo.saveOrganization(org);
  return { repo, org, service: new GovernanceService(repo) };
}

describe('GovernanceService.setToolRule', () => {
  it('allow persists to the policy blob and evaluates to allow over a require_approval default', () => {
    const { repo, org, service } = makeService();
    service.updateRiskDefaults(org.id, { write: 'require_approval' });

    service.setToolRule(org.id, {
      mcpId: 'd542',
      toolName: 'browser_*',
      state: 'allow',
    });

    const policy = repo.getGovernancePolicy(org.id);
    expect(policy.platform.always_allow).toHaveLength(1);

    const evaln = evaluatePolicy(policy, {
      agentId: 'a',
      mcpId: 'd542',
      toolName: 'browser_click',
      classification: 'write',
    });
    expect(evaln.state).toBe('allow');
    expect(evaln.source).toBe('platform_allow');
  });

  it('switching state moves the rule between buckets (never duplicates)', () => {
    const { repo, org, service } = makeService();
    service.setToolRule(org.id, { mcpId: 'd542', toolName: 'browser_run_code', state: 'allow' });
    service.setToolRule(org.id, { mcpId: 'd542', toolName: 'browser_run_code', state: 'deny' });

    const policy = repo.getGovernancePolicy(org.id);
    expect(policy.platform.always_allow).toHaveLength(0);
    expect(policy.platform.always_deny).toHaveLength(1);
  });

  it('inherit clears the rule from every bucket', () => {
    const { repo, org, service } = makeService();
    service.setToolRule(org.id, { mcpId: 'd542', toolName: 'browser_snapshot', state: 'allow' });
    service.setToolRule(org.id, { mcpId: 'd542', toolName: 'browser_snapshot', state: 'inherit' });

    const policy = repo.getGovernancePolicy(org.id);
    expect(policy.platform.always_allow).toHaveLength(0);
    expect(policy.platform.always_deny).toHaveLength(0);
    expect(policy.platform.default_require_approval).toHaveLength(0);
  });
});
