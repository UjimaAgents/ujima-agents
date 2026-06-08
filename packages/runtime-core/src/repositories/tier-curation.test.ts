import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OrganizationSchema,
  TierCurationSuggestionSchema,
} from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

// Two load-bearing invariants for the §9.4 curation scaffold —
// the analysis job in PR 9 will be the primary writer and the
// settings panel the primary reader.

function setup() {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = `org_${randomUUID()}`;
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Tier Curation Test Org',
      workspace: { root: '/tmp/tier-curation-test', roleScopes: {} },
    }),
  );
  return { repo, orgId };
}

describe('tier_curation_suggestions round-trip', () => {
  it('persists and reads back a suggestion with its signal metadata', () => {
    const { repo, orgId } = setup();
    const suggestion = TierCurationSuggestionSchema.parse({
      id: `tcs_${randomUUID()}`,
      organizationId: orgId,
      memberId: `mem_${randomUUID()}`,
      mcpServerId: `srv_${randomUUID()}`,
      direction: 'demote',
      rationale: 'Idle for 14 days; native palette budget can be reclaimed.',
      signalMetadata: { idleRuns: 14, lastInvokedAt: null },
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    repo.saveTierCurationSuggestion(suggestion);
    const rows = repo.listTierCurationSuggestions(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: 'demote',
      status: 'pending',
      signalMetadata: { idleRuns: 14, lastInvokedAt: null },
    });
  });

  it('UNIQUE constraint prevents duplicate pending suggestions for the same (member, server, direction)', () => {
    // PR 9's analyzer re-runs on a cron. Without the constraint a
    // re-run would stack identical suggestions in the UI; with the
    // ON CONFLICT DO NOTHING shape, the original suggestion's
    // created_at survives so the UI can show "first surfaced N days ago".
    const { repo, orgId } = setup();
    const baseline = {
      organizationId: orgId,
      memberId: `mem_${randomUUID()}`,
      mcpServerId: `srv_${randomUUID()}`,
      direction: 'demote' as const,
      rationale: 'first',
      signalMetadata: { idleRuns: 14 },
      status: 'pending' as const,
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    repo.saveTierCurationSuggestion(
      TierCurationSuggestionSchema.parse({ id: `tcs_${randomUUID()}`, ...baseline }),
    );
    repo.saveTierCurationSuggestion(
      TierCurationSuggestionSchema.parse({
        id: `tcs_${randomUUID()}`,
        ...baseline,
        rationale: 'second',
        createdAt: '2026-06-08T00:00:00.000Z',
      }),
    );
    const rows = repo.listTierCurationSuggestions(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rationale).toBe('first');
    expect(rows[0]!.createdAt).toBe('2026-06-01T00:00:00.000Z');
  });
});
