import { describe, expect, it } from 'vitest';
import { resolveClassification } from './effective-classification.js';
import type { McpToolClassification } from './org-schemas.js';

function row(overrides: Partial<McpToolClassification> = {}): McpToolClassification {
  return {
    organizationId: 'org_1',
    mcpServerId: 'mcp_fs',
    toolName: 'read_file',
    risk: 'read',
    source: 'inferred',
    needsReview: false,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveClassification', () => {
  it('returns unknown when neither stored nor inferred is provided', () => {
    expect(resolveClassification(null)).toEqual({ risk: 'unknown', source: 'unknown' });
  });

  it('falls through to inferred when no stored row exists', () => {
    expect(resolveClassification(null, 'write')).toEqual({
      risk: 'write',
      source: 'inferred',
    });
  });

  it('stored row wins over the on-the-fly inferred value', () => {
    const stored = row({ risk: 'destructive', source: 'manual' });
    expect(resolveClassification(stored, 'read')).toEqual({
      risk: 'destructive',
      source: 'manual',
    });
  });

  it('stored row preserves its declared source even when risk matches inferred', () => {
    const stored = row({ risk: 'read', source: 'inferred' });
    expect(resolveClassification(stored, 'read').source).toBe('inferred');
  });
});
