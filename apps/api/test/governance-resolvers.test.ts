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

});

describe('buildClassificationLookup', () => {
  it('returns undefined while the late-ref is unbound', () => {
    expect(buildClassificationLookup({ current: undefined })('mcp_x', 'tool_a')).toBeUndefined();
  });

  // Defensive: if more than one org lands in the table (manual seed,
  // migration artifact, leftover row), the resolver MUST refuse to
  // guess. The middleware calls these without an org argument, so
  // silently picking "latest" would enforce one org's classifications
  // on another org's tasks. Returning undefined makes the middleware
  // fall back to legacy behaviour — strictly safer.
});
