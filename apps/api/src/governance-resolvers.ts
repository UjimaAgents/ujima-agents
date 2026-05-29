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

export function buildPolicyResolver(
  ref: DaemonRepoRef,
): () => GovernancePolicy | undefined {
  return () => {
    const repo = ref.current;
    if (!repo) return undefined;
    const orgId = repo.getLatestOrganization()?.id;
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
    const orgId = repo.getLatestOrganization()?.id;
    if (!orgId) return undefined;
    const row = repo.getMcpToolClassification(orgId, mcpId, toolName);
    return row?.risk;
  };
}
