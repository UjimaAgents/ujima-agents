import type { McpToolClassification } from './org-schemas.js';
import type { ToolRiskClass } from './governance-policy.js';

export interface EffectiveClassification {
  risk: ToolRiskClass | 'unknown';
  source: 'manual' | 'inferred' | 'registry' | 'unknown';
}

// stored > inferred > unknown.
export function resolveClassification(
  stored: McpToolClassification | null,
  inferred?: ToolRiskClass,
): EffectiveClassification {
  if (stored) {
    return { risk: stored.risk, source: stored.source };
  }
  if (inferred) {
    return { risk: inferred, source: 'inferred' };
  }
  return { risk: 'unknown', source: 'unknown' };
}
