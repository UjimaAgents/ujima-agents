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

// Shared fixtures. We materialise an org + member + server up front
// so each attachment test exercises only the tier-aware code paths,
// not the surrounding wiring.
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
    description: 'OSINT scan data',
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

  return { repo, orgId, memberId, server, now, makeAttachment };
}

describe('AgentMcpAttachmentSchema tier field', () => {
  it("defaults tier to 'native' when omitted (backwards-compat for rows pre-048)", () => {
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

  it("accepts 'dispatch' explicitly", () => {
    const parsed = AgentMcpAttachmentSchema.parse({
      id: `att_${randomUUID()}`,
      organizationId: `org_${randomUUID()}`,
      memberId: `mem_${randomUUID()}`,
      mcpServerId: `srv_${randomUUID()}`,
      scope: 'both',
      tier: 'dispatch',
      createdAt: '2026-06-05T00:00:00.000Z',
      updatedAt: '2026-06-05T00:00:00.000Z',
    });
    expect(parsed.tier).toBe('dispatch');
  });

  it('rejects unknown tier values so typos surface at parse time', () => {
    expect(() =>
      AgentMcpAttachmentSchema.parse({
        id: `att_${randomUUID()}`,
        organizationId: `org_${randomUUID()}`,
        memberId: `mem_${randomUUID()}`,
        mcpServerId: `srv_${randomUUID()}`,
        scope: 'worker',
        tier: 'hybrid',
        createdAt: '2026-06-05T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('saveAgentMcpAttachment with tier', () => {
  it("persists tier and round-trips it through listAgentMcpAttachments", () => {
    const { repo, orgId, memberId, makeAttachment } = setupFixture();

    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'dispatch' }));

    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tier).toBe('dispatch');
  });

  it("ON CONFLICT updates tier so the upsert reflects the operator's latest choice", () => {
    const { repo, orgId, memberId, makeAttachment } = setupFixture();

    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'native' }));
    const later = new Date(Date.now() + 1000).toISOString();
    repo.saveAgentMcpAttachment(
      makeAttachment({ tier: 'dispatch', updatedAt: later }),
    );

    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows[0]?.tier).toBe('dispatch');
    expect(rows[0]?.updatedAt).toBe(later);
  });
});

describe('updateAttachmentTier', () => {
  it('flips an existing attachment from native to dispatch', () => {
    const { repo, orgId, memberId, server, makeAttachment } = setupFixture();
    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'native' }));

    const later = new Date(Date.now() + 1000).toISOString();
    const updated = repo.updateAttachmentTier(orgId, memberId, server.id, 'dispatch', later);

    expect(updated).not.toBeNull();
    expect(updated?.tier).toBe('dispatch');
    expect(updated?.updatedAt).toBe(later);
  });

  it('returns null when no attachment exists (no-op, no insert)', () => {
    const { repo, orgId, memberId, server } = setupFixture();
    // No saveAgentMcpAttachment first — table is empty for this pair.

    const result = repo.updateAttachmentTier(
      orgId,
      memberId,
      server.id,
      'dispatch',
      new Date().toISOString(),
    );
    expect(result).toBeNull();
    expect(repo.listAgentMcpAttachments(orgId, memberId)).toEqual([]);
  });

  it('rejects invalid tier values via Zod before touching the DB', () => {
    const { repo, orgId, memberId, server, makeAttachment } = setupFixture();
    repo.saveAgentMcpAttachment(makeAttachment({ tier: 'native' }));

    expect(() =>
      repo.updateAttachmentTier(
        orgId,
        memberId,
        server.id,
        'hybrid' as unknown as AgentMcpAttachment['tier'],
        new Date().toISOString(),
      ),
    ).toThrow();

    // Underlying row stays unchanged.
    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows[0]?.tier).toBe('native');
  });

  it('does not mutate scope (orthogonality with §17.5.3 merge rule)', () => {
    const { repo, orgId, memberId, server, makeAttachment } = setupFixture();
    repo.saveAgentMcpAttachment(makeAttachment({ scope: 'both', tier: 'native' }));

    repo.updateAttachmentTier(
      orgId,
      memberId,
      server.id,
      'dispatch',
      new Date().toISOString(),
    );

    const rows = repo.listAgentMcpAttachments(orgId, memberId);
    expect(rows[0]?.scope).toBe('both');
    expect(rows[0]?.tier).toBe('dispatch');
  });
});
