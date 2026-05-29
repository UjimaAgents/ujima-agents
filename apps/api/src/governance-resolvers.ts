import type { Repository } from '@ujima/runtime-core';
import type { GovernancePolicy, ToolRiskClass } from '@ujima/shared';

// Late-ref pattern: createRuntimeHost is constructed before the
// Repository wrapper that owns getGovernancePolicy /
// getMcpToolClassification, so the daemon entrypoint binds the ref
// AFTER the host returns. The host's permission middleware calls
// these resolvers per-check, so undefined-before-bind is safe.
export interface DaemonRepoRef {
  current: Repository | undefined;
}

// The runtime-host's permission middleware calls policyResolver() /
// classificationLookup(mcpId, toolName) without an org argument, so
// the daemon must determine the active org from its own state. The
// daemon is single-org per process by design (matches
// migrateUnifiedWorkspaceOrg). If a second org ever lands in the
// table — manual seed, migration artifact, leftover row — these
// resolvers REFUSE to guess. Returning undefined makes the
// middleware fall back to legacy behaviour, which is strictly safer
// than enforcing one org's policy on another org's tasks.
function resolveSingletonOrgId(repo: Repository): string | undefined {
  const orgs = repo.listOrganizations();
  if (orgs.length !== 1) return undefined;
  return orgs[0]?.id;
}

export function buildPolicyResolver(
  ref: DaemonRepoRef,
): () => GovernancePolicy | undefined {
  return () => {
    const repo = ref.current;
    if (!repo) return undefined;
    const orgId = resolveSingletonOrgId(repo);
    if (!orgId) return undefined;
    return repo.getGovernancePolicy(orgId);
  };
}

export function buildClassificationLookup(
  ref: DaemonRepoRef,
): (
  mcpId: string,
  toolName: string,
) => ToolRiskClass | 'unknown' | undefined {
  return (mcpId, toolName) => {
    const repo = ref.current;
    if (!repo) return undefined;
    const orgId = resolveSingletonOrgId(repo);
    if (!orgId) return undefined;
    const row = repo.getMcpToolClassification(orgId, mcpId, toolName);
    return row?.risk;
  };
}
