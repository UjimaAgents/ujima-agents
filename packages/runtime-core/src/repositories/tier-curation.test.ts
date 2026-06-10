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

  it('apply-revert-reapply round trip succeeds without UNIQUE constraint violation', async () => {
    // Bot finding: the UNIQUE constraint on
    // (org, member, server, direction, status) is what kept the
    // saveTierCurationSuggestion writer idempotent across cron
    // re-runs, but it ALSO meant that a regenerated `pending` row
    // couldn't be flipped to `applied` while a prior `applied` row
    // already occupied that slot. The fix DELETEs the prior terminal
    // row in the same transaction so the operator's most recent
    // decision wins.
    const { repo, orgId } = setup();
    const memberId = `mem_${randomUUID()}`;
    const serverId = `srv_${randomUUID()}`;

    // 1. Analyzer writes the first pending suggestion.
    const first = `tcs_${randomUUID()}`;
    repo.saveTierCurationSuggestion(
      TierCurationSuggestionSchema.parse({
        id: first,
        organizationId: orgId,
        memberId,
        mcpServerId: serverId,
        direction: 'demote',
        rationale: 'first idle pass',
        signalMetadata: { runsConsidered: 30 },
        status: 'pending',
        createdAt: '2026-06-01T00:00:00.000Z',
      }),
    );

    // 2. Operator clicks Apply. Status flips to 'applied'.
    const firstApplied = repo.updateTierCurationSuggestionStatus(
      orgId,
      first,
      'applied',
      '2026-06-01T01:00:00.000Z',
    );
    expect(firstApplied?.status).toBe('applied');

    // 3. Operator manually reverts the tier some time later. The
    //    pending slot is now free.
    // 4. Analyzer's next pass writes a fresh pending suggestion for
    //    the same (org, member, server, direction).
    const second = `tcs_${randomUUID()}`;
    repo.saveTierCurationSuggestion(
      TierCurationSuggestionSchema.parse({
        id: second,
        organizationId: orgId,
        memberId,
        mcpServerId: serverId,
        direction: 'demote',
        rationale: 'second idle pass',
        signalMetadata: { runsConsidered: 30 },
        status: 'pending',
        createdAt: '2026-06-09T00:00:00.000Z',
      }),
    );

    // 5. Operator clicks Apply again. Pre-fix this UPDATE would
    //    have raised "UNIQUE constraint failed" because the row
    //    from step 2 already occupied the (..., direction='demote',
    //    status='applied') slot. Post-fix the prior terminal row
    //    is DELETEd in the same transaction so the second Apply
    //    becomes the canonical applied row.
    expect(() =>
      repo.updateTierCurationSuggestionStatus(
        orgId,
        second,
        'applied',
        '2026-06-09T01:00:00.000Z',
      ),
    ).not.toThrow();

    // After the round trip there is exactly one row, and it carries
    // the operator's most recent decision (the regenerated suggestion).
    const rows = repo.listTierCurationSuggestions(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(second);
    expect(rows[0]!.status).toBe('applied');
    expect(rows[0]!.rationale).toBe('second idle pass');
  });
});
