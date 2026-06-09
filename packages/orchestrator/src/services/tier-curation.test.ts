import { describe, expect, it } from 'vitest';
import type {
  AgentMcpAttachment,
  AuditEvent,
  Member,
  RunState,
  TierCurationSuggestion,
} from '@ujima/shared';
import { createTierCurationService, type TierCurationDeps } from './tier-curation.js';

// Four load-bearing invariants for the §9.4 curation analyzer. Anything
// further (every threshold permutation, every event-shape edge case)
// belongs in the QA suite — these are the contracts the settings
// panel + rollout cadence rest on.

interface FixtureRepo extends TierCurationDeps['repo'] {
  saved: TierCurationSuggestion[];
}

function makeRepo(args: {
  members: Member[];
  attachmentsByMember: Record<string, AgentMcpAttachment[]>;
  audit: AuditEvent[];
  runs: RunState[];
}): FixtureRepo {
  const saved: TierCurationSuggestion[] = [];
  return {
    saved,
    saveTierCurationSuggestion: (suggestion) => {
      saved.push(suggestion);
      return suggestion;
    },
    listTierCurationSuggestions: () => saved.slice(),
    listAuditEvents: () => args.audit.slice(),
    listAgentMcpAttachments: (_org, memberId) =>
      args.attachmentsByMember[memberId] ?? [],
    listMembers: () => args.members.slice(),
    listRuns: (_org, _cursor, limit) => ({
      data: args.runs.slice(0, limit ?? args.runs.length),
      hasMore: false,
    }),
  };
}

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'mem_agent',
    organizationId: 'org_test',
    name: 'Agent',
    kind: 'agent',
    roleName: 'role',
    presence: 'offline',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAttachment(overrides: Partial<AgentMcpAttachment> = {}): AgentMcpAttachment {
  return {
    id: 'att_x',
    organizationId: 'org_test',
    memberId: 'mem_agent',
    mcpServerId: 'srv_x',
    scope: 'worker',
    tier: 'native',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRun(id: string): RunState {
  return {
    id,
    organizationId: 'org_test',
    agentId: 'mem_agent',
    status: 'completed',
    step: 'completed',
    summary: '',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
  };
}

function makeCompletion(args: {
  runId: string;
  memberId?: string;
  serverId?: string;
  toolName?: string;
  status?: 'ok' | 'error' | 'blocked';
}): AuditEvent {
  return {
    id: `aud_${args.runId}_${args.toolName ?? 'tool'}_${Math.random()}`,
    organizationId: 'org_test',
    actorId: args.memberId ?? 'mem_agent',
    action: 'connector_invocation_completed',
    targetType: 'mcp_tool',
    targetId: `${args.serverId ?? 'srv_x'}:${args.toolName ?? 'tool'}`,
    status: args.status ?? 'ok',
    metadata: { runId: args.runId, success: args.status !== 'error' },
    createdAt: '2026-06-08T00:00:00.000Z',
    serverId: args.serverId ?? 'srv_x',
    toolName: args.toolName ?? 'tool',
  };
}

describe('tier-curation analyzer', () => {
  it('writes a demote suggestion when a native attachment has zero completions in the window', async () => {
    const repo = makeRepo({
      members: [makeMember()],
      attachmentsByMember: {
        mem_agent: [makeAttachment({ tier: 'native' })],
      },
      audit: [],
      runs: [makeRun('run_1'), makeRun('run_2')],
    });
    const service = createTierCurationService({ repo });
    const result = await service.analyzeOrganization({
      organizationId: 'org_test',
      windowRuns: 30,
    });
    expect(result.suggestionsWritten).toBe(1);
    expect(result.demoteCount).toBe(1);
    expect(repo.saved[0]).toMatchObject({
      direction: 'demote',
      mcpServerId: 'srv_x',
      memberId: 'mem_agent',
      signalMetadata: { completions: 0, tierAtScoreTime: 'native' },
    });
  });

  it('writes a promote suggestion when a dispatch attachment is high-volume AND high-error', async () => {
    // 30 runs, dispatch attachment, 200 completions with 30 errors:
    // volumePerRun = 6.67 (above 5), errorRate = 0.15 (above 0.10).
    const runs = Array.from({ length: 30 }, (_, i) => makeRun(`run_${i}`));
    const audit: AuditEvent[] = [];
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        audit.push(
          makeCompletion({
            runId: `run_${i}`,
            status: j === 0 ? 'error' : 'ok',
          }),
        );
      }
      audit.push(makeCompletion({ runId: `run_${i}`, status: 'error' }));
    }
    const repo = makeRepo({
      members: [makeMember()],
      attachmentsByMember: {
        mem_agent: [makeAttachment({ tier: 'dispatch' })],
      },
      audit,
      runs,
    });
    const service = createTierCurationService({ repo });
    const result = await service.analyzeOrganization({ organizationId: 'org_test' });
    expect(result.promoteCount).toBe(1);
    expect(repo.saved[0]).toMatchObject({
      direction: 'promote',
      signalMetadata: {
        tierAtScoreTime: 'dispatch',
        runsConsidered: 30,
      },
    });
    const m = repo.saved[0]!.signalMetadata as { volumePerRun: number; errorRate: number };
    expect(m.volumePerRun).toBeCloseTo(7, 1);
    expect(m.errorRate).toBeGreaterThan(0.1);
  });

  it('does NOT count blocked rows as completions (policy denials must not inflate volume into a false promote)', async () => {
    // Bot finding: every blocked invocation must be excluded BEFORE
    // counting, otherwise a dispatch tool that keeps tripping
    // require_approval but never actually runs would clear the
    // volumePerRunThreshold purely from operator rejections, never
    // adding to errors (blocked != error), so the analyzer would
    // recommend promoting a tool the org has actively chosen to gate.
    // 200 blocked completions across 30 runs is 6.67 volume_per_run
    // — above the default 5 threshold — but should still produce
    // zero suggestions because each row is a denial, not an outcome.
    const runs = Array.from({ length: 30 }, (_, i) => makeRun(`run_${i}`));
    const audit: AuditEvent[] = [];
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 7; j += 1) {
        audit.push(makeCompletion({ runId: `run_${i}`, status: 'blocked' }));
      }
    }
    const repo = makeRepo({
      members: [makeMember()],
      attachmentsByMember: {
        mem_agent: [makeAttachment({ tier: 'dispatch' })],
      },
      audit,
      runs,
    });
    const service = createTierCurationService({ repo });
    const result = await service.analyzeOrganization({ organizationId: 'org_test' });
    expect(result.suggestionsWritten).toBe(0);
    expect(repo.saved).toHaveLength(0);
  });

  it('does NOT promote a dispatch tool that is high-volume but low-error (the model is handling the indirection fine)', async () => {
    // Volume alone is not enough — the error-rate gate is what makes
    // the promote candidate. A hot but reliable read tool stays on
    // dispatch, preserving the native palette budget.
    const runs = Array.from({ length: 30 }, (_, i) => makeRun(`run_${i}`));
    const audit: AuditEvent[] = [];
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 10; j += 1) {
        audit.push(makeCompletion({ runId: `run_${i}`, status: 'ok' }));
      }
    }
    const repo = makeRepo({
      members: [makeMember()],
      attachmentsByMember: {
        mem_agent: [makeAttachment({ tier: 'dispatch' })],
      },
      audit,
      runs,
    });
    const service = createTierCurationService({ repo });
    const result = await service.analyzeOrganization({ organizationId: 'org_test' });
    expect(result.suggestionsWritten).toBe(0);
  });

  it('returns zero with runsConsidered=0 when the org has no runs to score against', async () => {
    // A brand-new org or an org with the dispatch flag freshly flipped
    // on shouldn't generate spurious demote candidates for every
    // native attachment that hasn't had a chance to be exercised yet.
    const repo = makeRepo({
      members: [makeMember()],
      attachmentsByMember: {
        mem_agent: [makeAttachment({ tier: 'native' })],
      },
      audit: [],
      runs: [],
    });
    const service = createTierCurationService({ repo });
    const result = await service.analyzeOrganization({ organizationId: 'org_test' });
    expect(result).toEqual({
      suggestionsWritten: 0,
      demoteCount: 0,
      promoteCount: 0,
      runsConsidered: 0,
    });
    expect(repo.saved).toHaveLength(0);
  });
});
