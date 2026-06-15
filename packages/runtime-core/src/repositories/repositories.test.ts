import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { MessageSchema, OrganizationSchema } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import type { SecretStore } from '../secret-store.js';
import { Repository } from './index.js';

function createCountingSecretStore(): SecretStore & { count(): number } {
  const map = new Map<string, string>();
  return {
    write(value) {
      const keyRef = randomUUID();
      map.set(keyRef, value);
      return keyRef;
    },
    read(keyRef) {
      return map.get(keyRef) ?? null;
    },
    delete(keyRef) {
      map.delete(keyRef);
    },
    count() {
      return map.size;
    },
  };
}

test('provider credentials stay scoped to their organization', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));

  const firstOrganization = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'First Org',
    workspace: {
      root: '/tmp/first-org',
      roleScopes: {},
    },
  });

  const secondOrganization = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Second Org',
    workspace: {
      root: '/tmp/second-org',
      roleScopes: {},
    },
  });

  repo.saveOrganization(firstOrganization);
  repo.saveProviderCredential(firstOrganization.id, 'openai', 'sk-first');
  repo.saveOrganization(secondOrganization);

  expect(repo.getProviderCredential(firstOrganization.id, 'openai')).toBe('sk-first');
  expect(repo.getProviderCredential(secondOrganization.id, 'openai')).toBeNull();
  expect(repo.getOrganization(secondOrganization.id)?.id).toBe(secondOrganization.id);
});

test('saveOrganization upserts the matching workspace catalog row', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const org = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Workspace Org',
    workspace: {
      root: './tmp/workspace-org',
      roleScopes: {},
    },
  });

  repo.saveOrganization(org);
  const firstRow = db
    .prepare('SELECT id, root_path, label FROM workspaces WHERE id = ?')
    .get(`ws_${org.id}`) as { id: string; root_path: string; label: string } | undefined;

  expect(firstRow?.id).toBe(`ws_${org.id}`);
  expect(firstRow?.root_path).toBeDefined();
  expect(firstRow?.label).toBe('Workspace Org');

  repo.saveOrganization({
    ...org,
    name: 'Renamed Workspace Org',
    workspace: { ...org.workspace, root: '/tmp/workspace-org-renamed' },
  });
  const updatedRow = db
    .prepare('SELECT id, root_path, label FROM workspaces WHERE id = ?')
    .get(`ws_${org.id}`) as { id: string; root_path: string; label: string } | undefined;

  expect(updatedRow?.label).toBe('Renamed Workspace Org');
  expect(updatedRow?.root_path).toContain('workspace-org-renamed');
});

test('members are isolated per organization and preserve role name', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = new Date().toISOString();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Org',
      workspace: { root: '/tmp/org', roleScopes: {} },
    }),
  );

  repo.saveMember({
    id: randomUUID(),
    organizationId: orgId,
    name: 'Alice',
    kind: 'human',
    roleName: 'Project Manager',
    presence: 'online',
    createdAt: now,
  });

  const otherOrgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: otherOrgId,
      name: 'Other',
      workspace: { root: '/tmp/other', roleScopes: {} },
    }),
  );
  repo.saveMember({
    id: randomUUID(),
    organizationId: otherOrgId,
    name: 'Bob',
    kind: 'agent',
    roleName: 'Reviewer',
    presence: 'offline',
    createdAt: now,
  });

  const members = repo.listMembers(orgId);
  expect(members).toHaveLength(1);
  expect(members[0]?.roleName).toBe('Project Manager');
});

test('provider credentials round-trip through the secret store, not plaintext DB', () => {
  const secrets = createCountingSecretStore();
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db, secrets);

  const org = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Secret Org',
    workspace: { root: '/tmp/secret-org', roleScopes: {} },
  });
  repo.saveOrganization(org);
  repo.saveProviderCredential(org.id, 'openai', 'sk-plaintext');

  const row = db
    .prepare('SELECT key_ref FROM provider_credentials WHERE organization_id = ? AND provider_name = ?')
    .get(org.id, 'openai') as { key_ref: string } | undefined;

  expect(row?.key_ref).toBeDefined();
  expect(row?.key_ref).not.toBe('sk-plaintext');
  expect(repo.getProviderCredential(org.id, 'openai')).toBe('sk-plaintext');
});

test('getLatestHumanMessageInThread returns newest human by timestamp', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = '2026-05-04T19:07:00.000Z';

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Latest Human Org',
      workspace: { root: '/tmp/latest-human', roleScopes: {} },
    }),
  );
  repo.saveChannel({
    id: 'general',
    organizationId: orgId,
    name: 'general',
    kind: 'general',
    topic: '',
    memberIds: [],
  });
  repo.ensureThread({
    id: 'general',
    organizationId: orgId,
    channelId: 'general',
    title: 'general',
    memberIds: [],
    createdAt: now,
  });

  repo.saveMessage(
    MessageSchema.parse({
      id: 'h-old',
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'u1',
      senderKind: 'human',
      kind: 'human',
      content: 'first',
      mentions: [],
      metadata: { goalMode: false },
      createdAt: '2026-05-04T19:07:01.000Z',
    }),
  );
  for (let i = 0; i < 3; i++) {
    repo.saveMessage(
      MessageSchema.parse({
        id: `a-${i}`,
        organizationId: orgId,
        threadId: 'general',
        channelId: 'general',
        senderId: 'agent',
        senderKind: 'agent',
        kind: 'agent',
        content: `agent ${i}`,
        mentions: [],
        createdAt: `2026-05-04T19:07:0${2 + i}.000Z`,
      }),
    );
  }
  repo.saveMessage(
    MessageSchema.parse({
      id: 'h-new',
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'u1',
      senderKind: 'human',
      kind: 'human',
      content: 'second',
      mentions: [],
      metadata: { goalMode: true },
      createdAt: '2026-05-04T19:07:09.000Z',
    }),
  );

  const latest = repo.getLatestHumanMessageInThread(orgId, 'general');
  expect(latest?.id).toBe('h-new');
  expect(latest?.metadata).toEqual({ goalMode: true });
});

// L10 race-safety: migration 021 enforces uniqueness in the DB.
// Two inserts with the same (org, sender, thread, clientMessageId)
// triple must dedupe — saveMessage catches the UNIQUE constraint
// and returns the existing row instead of bubbling the error.
test('saveMessage is race-safe on duplicate clientMessageId (returns winner instead of throwing)', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Race Org',
      workspace: { root: '/tmp/race-org', roleScopes: {} },
    }),
  );
  const senderId = 'owner';
  const sharedClientMessageId = 'concurrent-retry-token';

  const first = repo.saveMessage(
    MessageSchema.parse({
      id: 'msg-winner',
      organizationId: orgId,
      threadId: 'thread-1',
      channelId: 'thread-1',
      senderId,
      senderKind: 'human',
      kind: 'human',
      content: 'first to commit',
      mentions: [],
      clientMessageId: sharedClientMessageId,
      createdAt: '2026-05-04T19:07:01.000Z',
    }),
  );
  expect(first.id).toBe('msg-winner');

  // Second concurrent attempt with the SAME triple — different
  // message id (because it was generated server-side for a
  // retried POST), same dedupe key.
  const second = repo.saveMessage(
    MessageSchema.parse({
      id: 'msg-loser',
      organizationId: orgId,
      threadId: 'thread-1',
      channelId: 'thread-1',
      senderId,
      senderKind: 'human',
      kind: 'human',
      content: 'second arrival',
      mentions: [],
      clientMessageId: sharedClientMessageId,
      createdAt: '2026-05-04T19:07:01.050Z',
    }),
  );
  // Recovery: caller gets the WINNER, not the loser's payload.
  expect(second.id).toBe('msg-winner');
  expect(second.content).toBe('first to commit');

  // Only one row persisted.
  expect(
    repo.listMessages(orgId, 'thread-1').data.filter(
      (m) => (m as { clientMessageId?: string }).clientMessageId === sharedClientMessageId,
    ),
  ).toHaveLength(1);
});

test('hasApprovalGrant matches org-wide canonical scope regardless of requesting agent', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Org-Wide Grant Org',
      workspace: { root: '/tmp/org-wide-grant', roleScopes: {} },
    }),
  );

  const grantScope = 'shell:{"cwd":"/workspace","command":"npm","args":["test"]}';
  repo.saveApproval({
    id: randomUUID(),
    organizationId: orgId,
    runId: randomUUID(),
    toolCallId: randomUUID(),
    requestedBy: 'agent-owner',
    resourceType: 'shell',
    resourcePath: '/workspace',
    action: 'execute',
    status: 'approved',
    reason: `grant:always_allow:scope=${encodeURIComponent(grantScope)};note=owner-grant`,
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  });

  expect(
    repo.hasApprovalGrant({
      organizationId: orgId,
      resourceType: 'shell',
      action: 'execute',
      approvalScope: grantScope,
    }),
  ).toBe(true);
});

// Regression for two listChannels() bugs:
//   (A) Pagination drift — filtering self/dm in JS *after* paging meant
//       hasMore/nextCursor were computed against the unfiltered set, so once
//       hidden channels existed the cursor could point at a hidden row and
//       skip visible ones.
//   (B) DM leak — only `self` was being filtered, so `dm` channels surfaced
//       in BootstrapService and SettingsService payloads (callers without a
//       member identity could see private 2-member conversations).
test('channel membership stays mirrored and reads tolerate drift', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Membership Org',
      workspace: { root: '/tmp/membership-org', roleScopes: {} },
    }),
  );
  repo.saveChannel({
    id: 'general',
    organizationId: orgId,
    name: 'general',
    kind: 'general',
    topic: '',
    memberIds: [],
  });
  repo.ensureThread({
    id: 'general',
    organizationId: orgId,
    channelId: 'general',
    title: 'general',
    memberIds: [],
    createdAt: '2026-04-27T08:00:00.000Z',
  });

  repo.setChannelMembers(orgId, 'general', ['ava']);
  const mirroredThreadMembers = db
    .prepare('SELECT member_id FROM thread_members WHERE thread_id = ? ORDER BY member_id ASC')
    .all('general') as { member_id: string }[];
  expect(mirroredThreadMembers.map((row) => row.member_id)).toEqual(['ava']);

  db.prepare(
    'DELETE FROM channel_members WHERE organization_id = ? AND channel_id = ?',
  ).run(orgId, 'general');
  db.prepare(
    'INSERT INTO channel_members (organization_id, channel_id, member_id) VALUES (?, ?, ?)',
  ).run(orgId, 'general', 'phoebe');

  expect(repo.getChannel(orgId, 'general')?.memberIds).toEqual(['ava', 'phoebe']);
});

// Regression: paginators used to cursor only on `created_at`, so two rows
// sharing the same millisecond timestamp could be split across the page
// boundary and the second one would be skipped forever (the cursor pointed
// past it). Composite cursor `${created_at}|${id}` fixes the boundary.
test('listChannelMessages preserves rows that share the same created_at across page boundaries', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Cursor Org',
      workspace: { root: '/tmp/cursor-org', roleScopes: {} },
    }),
  );
  repo.saveChannel({
    id: 'general',
    organizationId: orgId,
    name: 'general',
    kind: 'general',
    topic: '',
    memberIds: [],
  });
  repo.ensureThread({
    id: 'general',
    organizationId: orgId,
    channelId: 'general',
    title: 'general',
    memberIds: [],
    createdAt: '2026-04-27T08:00:00.000Z',
  });

  // Three messages, three distinct ids, one shared millisecond. Pre-fix,
  // paging with limit=2 returned msg-c+msg-b on page 1, then a cursor that
  // dropped msg-a entirely (cursor `2026-04-27T08:00:00.000Z` excluded ALL
  // rows with `created_at = '2026-04-27T08:00:00.000Z'`).
  for (const id of ['msg-a', 'msg-b', 'msg-c']) {
    repo.saveMessage(
      MessageSchema.parse({
        id,
        organizationId: orgId,
        threadId: 'general',
        channelId: 'general',
        senderId: 'user',
        senderKind: 'human',
        kind: 'human',
        content: id,
        mentions: [],
        createdAt: '2026-04-27T08:00:00.000Z',
      }),
    );
  }

  const page1 = repo.listChannelMessages(orgId, 'general', { limit: 2 });
  expect(page1.data).toHaveLength(2);
  expect(page1.hasMore).toBe(true);
  expect(page1.nextCursor).toBeDefined();

  const page2 = repo.listChannelMessages(orgId, 'general', {
    limit: 2,
    cursor: page1.nextCursor,
  });
  expect(page2.data).toHaveLength(1);
  expect(page2.hasMore).toBe(false);

  const allIds = [...page1.data.map((m) => m.id), ...page2.data.map((m) => m.id)].sort();
  expect(allIds).toEqual(['msg-a', 'msg-b', 'msg-c']);
});

// ---------------------------------------------------------------------
// Goal System Repository tests
// ---------------------------------------------------------------------

