import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AuditEventSchema,
  OrganizationSchema,
  type AuditEvent,
} from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import { Repository } from './index.js';

// Two load-bearing invariants for the §12 connector-action audit unwrap.
// Anything further (every event-type variation, redaction policy, etc.)
// lives in the QA testing harness — these are the contracts the
// approval card + timeline + operator queries rest on.

function setupFixture() {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = `org_${randomUUID()}`;
  const now = new Date().toISOString();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Audit Unwrap Test Org',
      workspace: { root: '/tmp/audit-unwrap-test', roleScopes: {} },
    }),
  );
  return { repo, orgId, now };
}

describe('audit_events tool-unwrap round-trip', () => {
  it('persists and reads back the (server_id, tool_name, args_json) tuple', () => {
    const { repo, orgId, now } = setupFixture();
    const id = `aud_${randomUUID()}`;
    const argsJson = JSON.stringify({
      channel: '#team',
      text: 'Migration PR opened',
    });
    const event: AuditEvent = AuditEventSchema.parse({
      id,
      organizationId: orgId,
      actorId: `mem_${randomUUID()}`,
      action: 'connector_invocation_requested',
      targetType: 'mcp_tool',
      targetId: 'slack.post_message',
      status: 'ok',
      createdAt: now,
      metadata: {},
      serverId: 'slack',
      toolName: 'post_message',
      argsJson,
    });

    repo.saveAuditEvent(event);
    const rows = repo.listAuditEvents(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      serverId: 'slack',
      toolName: 'post_message',
      argsJson,
    });
  });

  it('leaves the unwrap columns null on legacy events', () => {
    // The columns are optional so existing emitters (org-level
    // workspace events, etc.) round-trip without code changes. A
    // future caller that forgets to populate them gracefully reads
    // back as undefined rather than throwing a Zod parse error.
    const { repo, orgId, now } = setupFixture();
    const id = `aud_${randomUUID()}`;
    repo.saveAuditEvent(
      AuditEventSchema.parse({
        id,
        organizationId: orgId,
        action: 'workspace.rename',
        targetType: 'workspace',
        targetId: 'ws_42',
        status: 'ok',
        createdAt: now,
      }),
    );
    const rows = repo.listAuditEvents(orgId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.serverId).toBeUndefined();
    expect(row.toolName).toBeUndefined();
    expect(row.argsJson).toBeUndefined();
  });
});
