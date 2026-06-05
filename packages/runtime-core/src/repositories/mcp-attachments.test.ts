import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AgentMcpAttachmentSchema,
  McpServerSchema,
  OrganizationSchema,
  type AgentMcpAttachment,
  type McpServer,
} from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

// Three load-bearing invariants for the dispatch substrate. Anything
// further (parametric variations, negative cases, etc.) lives in the
// QA testing harness — these are the contracts the rest of the plan
// rests on.

function setupFixture() {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = `org_${randomUUID()}`;
  const memberId = `mem_${randomUUID()}`;
  const now = new Date().toISOString();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Dispatch Test Org',
      workspace: { root: '/tmp/dispatch-test', roleScopes: {} },
    }),
  );
  repo.saveMember({
    id: memberId,
    organizationId: orgId,
    name: 'Snoop',
    kind: 'agent',
    roleName: 'investigator',
    presence: 'offline',
    createdAt: now,
  });

  const server: McpServer = McpServerSchema.parse({
    id: `srv_${randomUUID()}`,
    organizationId: orgId,
    name: 'shodan',
    description: '',
    category: 'security',
    transport: 'stdio',
    command: 'true',
    args: [],
    isolation: 'shared',
    status: 'active',
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
  });
  repo.saveMcpServer(server);

  function makeAttachment(overrides: Partial<AgentMcpAttachment> = {}): AgentMcpAttachment {
    return AgentMcpAttachmentSchema.parse({
      id: overrides.id ?? `att_${randomUUID()}`,
      organizationId: orgId,
      memberId,
      mcpServerId: server.id,
      scope: 'worker',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  }
  return { repo, orgId, memberId, server, makeAttachment };
}

describe('dispatch substrate — load-bearing invariants', () => {
  it("backwards compat: tier defaults to 'native' when omitted (pre-048 rows)", () => {
    // Critical for §3.5 rule 2: existing org rows that pre-date migration
    // 048 must read back as 'native' so legacy spawn behavior is exact.
    const parsed = AgentMcpAttachmentSchema.parse({
      id: `att_${randomUUID()}`,
      organizationId: `org_${randomUUID()}`,
      memberId: `mem_${randomUUID()}`,
      mcpServerId: `srv_${randomUUID()}`,
      scope: 'worker',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    expect(parsed.tier).toBe('native');
  });

  it('save round-trips tier and updates it on UPSERT conflict', () => {
    // Combined save + read + conflict-update path — covers the entire
    // saveAgentMcpAttachment surface in one assertion chain.
    const { repo, orgId, memberId, makeAttachment } = setupFixture();
    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'native' }));
    const later = new Date(Date.now() + 1000).toISOString();
    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'dispatch', updatedAt: later }));

    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tier).toBe('dispatch');
    expect(rows[0]?.updatedAt).toBe(later);
  });

  it('updateAttachmentTier flips tier and preserves scope (orthogonality invariant §17.5.3)', () => {
    // The reviewer specifically flagged that tier mutation must NOT
    // touch scope; tier and the permission-store grant are orthogonal.
    // This is the test that catches a future refactor breaking that.
    const { repo, orgId, memberId, server, makeAttachment } = setupFixture();
    repo.saveAgentMcpAttachment(makeAttachment({ scope: 'both', tier: 'native' }));
    repo.updateAttachmentTier(orgId, memberId, server.id, 'dispatch', new Date().toISOString());

    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows[0]?.scope).toBe('both');
    expect(rows[0]?.tier).toBe('dispatch');
  });
});
