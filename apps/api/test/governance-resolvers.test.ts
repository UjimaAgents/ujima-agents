import { describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import { OrganizationSchema, setRiskDefaults, emptyGovernancePolicy } from '@ujima/shared';
import {
  buildClassificationLookup,
  buildPolicyResolver,
  type DaemonRepoRef,
} from '../src/governance-resolvers.js';

// Locks the contract the daemon entrypoint depends on. apps/api/src/main.ts
// constructs createRuntimeHost BEFORE the Repository wrapper, so the
// resolver closures it passes need to defer their repo read via a
// late-bound ref. These tests pin that pattern:
//
//   - the resolvers return undefined safely before the ref is bound
//     (which is the window between createRuntimeHost() and
//      `lateRepoRef.current = repository`);
//   - once bound, they return the live policy / classification for the
//     daemon's active org, scoped through getLatestOrganization() (the
//     daemon is single-org per process, matching
//     migrateUnifiedWorkspaceOrg);
//   - both update as the policy / classifications change without
//     re-binding — pinning that policy edits and admin classification
//     overrides reach the runtime-host middleware on the next call.

function makeRepo(): Repository {
  return new Repository(openDatabase({ dbPath: ':memory:' }));
}

function seedOrg(repo: Repository) {
  const org = OrganizationSchema.parse({
    id: 'org-1',
    name: 'Org 1',
    workspace: { root: '/tmp/org-1', roleScopes: {} },
  });
  repo.saveOrganization(org);
  return org;
}

describe('buildPolicyResolver', () => {
  it('returns undefined while the late-ref is unbound', () => {
    const ref: DaemonRepoRef = { current: undefined };
    expect(buildPolicyResolver(ref)()).toBeUndefined();
  });

  it('returns undefined when no org has been onboarded yet', () => {
    const repo = makeRepo();
    const ref: DaemonRepoRef = { current: repo };
    expect(buildPolicyResolver(ref)()).toBeUndefined();
  });

  it('returns the live policy for the active org once bound', () => {
    const repo = makeRepo();
    const org = seedOrg(repo);
    const policy = setRiskDefaults(emptyGovernancePolicy(), {
      destructive: 'deny',
    });
    repo.saveGovernancePolicy(org.id, policy);

    const resolve = buildPolicyResolver({ current: repo });
    const first = resolve();
    expect(first?.risk_defaults.destructive).toBe('deny');
  });

  it('reflects policy edits on the very next call (no stale snapshot)', () => {
    const repo = makeRepo();
    const org = seedOrg(repo);
    const ref: DaemonRepoRef = { current: repo };
    const resolve = buildPolicyResolver(ref);

    repo.saveGovernancePolicy(
      org.id,
      setRiskDefaults(emptyGovernancePolicy(), { read: 'allow' }),
    );
    expect(resolve()?.risk_defaults.read).toBe('allow');

    repo.saveGovernancePolicy(
      org.id,
      setRiskDefaults(emptyGovernancePolicy(), { read: 'deny' }),
    );
    expect(resolve()?.risk_defaults.read).toBe('deny');
  });
});

describe('buildClassificationLookup', () => {
  it('returns undefined while the late-ref is unbound', () => {
    expect(buildClassificationLookup({ current: undefined })('mcp_x', 'tool_a')).toBeUndefined();
  });

  it('returns undefined when no org has been onboarded yet', () => {
    const repo = makeRepo();
    expect(buildClassificationLookup({ current: repo })('mcp_x', 'tool_a')).toBeUndefined();
  });

  it('returns the stored risk for the active org', () => {
    const repo = makeRepo();
    const org = seedOrg(repo);
    repo.upsertMcpToolClassification({
      organizationId: org.id,
      mcpServerId: 'mcp_x',
      toolName: 'delete_thing',
      risk: 'destructive',
      source: 'manual',
      needsReview: false,
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin',
    });

    const lookup = buildClassificationLookup({ current: repo });
    expect(lookup('mcp_x', 'delete_thing')).toBe('destructive');
  });

  it('reflects classification edits on the very next call', () => {
    const repo = makeRepo();
    const org = seedOrg(repo);
    const ref: DaemonRepoRef = { current: repo };
    const lookup = buildClassificationLookup(ref);
    const now = () => new Date().toISOString();

    repo.upsertMcpToolClassification({
      organizationId: org.id,
      mcpServerId: 'mcp_x',
      toolName: 'tool_a',
      risk: 'read',
      source: 'manual',
      needsReview: false,
      updatedAt: now(),
      updatedBy: 'admin',
    });
    expect(lookup('mcp_x', 'tool_a')).toBe('read');

    repo.upsertMcpToolClassification({
      organizationId: org.id,
      mcpServerId: 'mcp_x',
      toolName: 'tool_a',
      risk: 'destructive',
      source: 'manual',
      needsReview: false,
      updatedAt: now(),
      updatedBy: 'admin',
    });
    expect(lookup('mcp_x', 'tool_a')).toBe('destructive');
  });

  it('returns undefined for unknown (mcp, tool) pairs', () => {
    const repo = makeRepo();
    seedOrg(repo);
    expect(buildClassificationLookup({ current: repo })('mcp_x', 'mystery')).toBeUndefined();
  });

  // Defensive: if more than one org lands in the table (manual seed,
  // migration artifact, leftover row), the resolver MUST refuse to
  // guess. The middleware calls these without an org argument, so
  // silently picking "latest" would enforce one org's classifications
  // on another org's tasks. Returning undefined makes the middleware
  // fall back to legacy behaviour — strictly safer.
  it('refuses to guess when more than one org exists', () => {
    const repo = makeRepo();
    seedOrg(repo);
    const second = OrganizationSchema.parse({
      id: 'org-2',
      name: 'Org 2',
      workspace: { root: '/tmp/org-2', roleScopes: {} },
    });
    repo.saveOrganization(second);

    expect(buildPolicyResolver({ current: repo })()).toBeUndefined();
    expect(
      buildClassificationLookup({ current: repo })('mcp_x', 'tool_a'),
    ).toBeUndefined();
  });
});
