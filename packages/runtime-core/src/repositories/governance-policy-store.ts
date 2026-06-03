import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import {
  GovernancePolicy,
  emptyGovernancePolicy,
  type GovernancePolicy as GovernancePolicyShape,
} from '@ujima/shared';
import {
  getWorkspaceSetting,
  saveWorkspaceSetting,
} from './organization.js';

// Single per-org row rides workspace_settings rather than getting its own table.
export const GOVERNANCE_POLICY_SETTING_KEY = 'governance:policy:v1';

export function getGovernancePolicyForOrg(
  db: DbHandle,
  organizationId: string,
): GovernancePolicyShape {
  const raw = getWorkspaceSetting(db, organizationId, GOVERNANCE_POLICY_SETTING_KEY);
  if (!raw) return emptyGovernancePolicy();
  try {
    const parsed = JSON.parse(raw) as unknown;
    return GovernancePolicy.parse(parsed);
  } catch {
    return emptyGovernancePolicy();
  }
}

export function saveGovernancePolicyForOrg(
  db: DbHandle,
  organizationId: string,
  policy: GovernancePolicyShape,
): GovernancePolicyShape {
  const parsed = GovernancePolicy.parse({
    ...policy,
    updated_at: new Date().toISOString(),
  });
  saveWorkspaceSetting(
    db,
    organizationId,
    GOVERNANCE_POLICY_SETTING_KEY,
    JSON.stringify(parsed),
  );
  return parsed;
}
