import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { MessageSchema, OrganizationSchema, RunStateSchema, ApprovalRequestSchema } from '@ujima/shared';
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

test('bootstrap snapshot returns empty shape when no organization exists', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const snap = repo.getBootstrapSnapshot();
  expect(snap.organization).toBeNull();
  expect(snap.members).toEqual([]);
  expect(snap.channels).toEqual([]);
  expect(snap.pendingApprovals).toEqual([]);
  expect(snap.activeRuns).toEqual([]);
  expect(snap.providerCredentials).toEqual({});
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

test('overwriting a provider credential deletes the previous secret', () => {
  const secrets = createCountingSecretStore();
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }), secrets);

  const org = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Rotating Org',
    workspace: { root: '/tmp/rotating', roleScopes: {} },
  });
  repo.saveOrganization(org);

  repo.saveProviderCredential(org.id, 'openai', 'first');
  const firstCount = secrets.count();
  repo.saveProviderCredential(org.id, 'openai', 'second');

  expect(secrets.count()).toBe(firstCount);
  expect(repo.getProviderCredential(org.id, 'openai')).toBe('second');
});

test('deleteProviderCredential removes the stored secret and DB row', () => {
  const secrets = createCountingSecretStore();
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }), secrets);

  const org = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Deleting Org',
    workspace: { root: '/tmp/deleting', roleScopes: {} },
  });
  repo.saveOrganization(org);
  repo.saveProviderCredential(org.id, 'openai', 'sk-key');
  expect(secrets.count()).toBe(1);

  repo.deleteProviderCredential(org.id, 'openai');

  expect(secrets.count()).toBe(0);
  expect(repo.getProviderCredential(org.id, 'openai')).toBeNull();
});

test('listOrganizations returns every saved organization', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));

  const first = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'First',
    workspace: { root: '/tmp/a', roleScopes: {} },
  });
  const second = OrganizationSchema.parse({
    id: randomUUID(),
    name: 'Second',
    workspace: { root: '/tmp/b', roleScopes: {} },
  });

  repo.saveOrganization(first);
  repo.saveOrganization(second);

  const ids = repo.listOrganizations().map((o) => o.id).sort();
  expect(ids).toEqual([first.id, second.id].sort());
});

test('searchChannelMessages tolerates unmatched quotes in user search text', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = new Date().toISOString();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Search Org',
      workspace: { root: '/tmp/search-org', roleScopes: {} },
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
      id: randomUUID(),
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'user',
      senderKind: 'human',
      kind: 'human',
      content: 'quoted needle here',
      mentions: [],
      createdAt: now,
    }),
  );

  const results = repo.searchChannelMessages(orgId, 'general', 'needle"', { limit: 10 });
  expect(results.data.map((message) => message.content)).toContain('quoted needle here');
});

test('message metadata (goalMode) round-trips through save, list, get, and update', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = new Date().toISOString();
  const messageId = randomUUID();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Meta Org',
      workspace: { root: '/tmp/meta-org', roleScopes: {} },
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

  const saved = repo.saveMessage(
    MessageSchema.parse({
      id: messageId,
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'user',
      senderKind: 'human',
      kind: 'human',
      content: 'goal',
      mentions: [],
      metadata: { goalMode: true },
      createdAt: now,
    }),
  );
  expect(saved.metadata).toEqual({ goalMode: true });

  const listed = repo.listMessages(orgId, 'general', undefined, 10).data.find((m) => m.id === messageId);
  expect(listed?.metadata).toEqual({ goalMode: true });

  const got = repo.getMessage(orgId, messageId);
  expect(got?.metadata).toEqual({ goalMode: true });

  repo.updateMessage(
    MessageSchema.parse({
      ...saved,
      content: 'updated',
      metadata: { goalMode: false },
      editedAt: new Date().toISOString(),
    }),
  );
  expect(repo.getMessage(orgId, messageId)?.metadata).toEqual({ goalMode: false });
});

test('message reasoning content round-trips through save, list, get, and update', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = new Date().toISOString();
  const messageId = randomUUID();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Reasoning Org',
      workspace: { root: '/tmp/reasoning-org', roleScopes: {} },
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

  const saved = repo.saveMessage(
    MessageSchema.parse({
      id: messageId,
      organizationId: orgId,
      threadId: 'general',
      channelId: 'general',
      senderId: 'agent',
      senderKind: 'agent',
      kind: 'agent',
      content: 'Visible reply',
      reasoningContent: 'Private reasoning',
      mentions: [],
      createdAt: now,
    }),
  );
  expect(saved.reasoningContent).toBe('Private reasoning');
  expect(repo.getMessage(orgId, messageId)?.reasoningContent).toBe('Private reasoning');
  expect(repo.listMessages(orgId, 'general', undefined, 10).data[0]?.reasoningContent).toBe('Private reasoning');

  repo.updateMessage(
    MessageSchema.parse({
      ...saved,
      reasoningContent: 'Updated reasoning',
      editedAt: new Date().toISOString(),
    }),
  );
  expect(repo.getMessage(orgId, messageId)?.reasoningContent).toBe('Updated reasoning');
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

test('hasApprovalGrant matches legacy shell scopes against canonical JSON scopes', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Approval Org',
      workspace: { root: '/tmp/approval-org', roleScopes: {} },
    }),
  );

  const legacyScope = 'shell:/workspace:git:["status"]';
  repo.saveApproval({
    id: randomUUID(),
    organizationId: orgId,
    runId: randomUUID(),
    toolCallId: randomUUID(),
    requestedBy: 'agent-1',
    resourceType: 'shell',
    resourcePath: '/workspace',
    action: 'execute',
    status: 'approved',
    reason: `grant:always_allow:scope=${encodeURIComponent(legacyScope)};note=legacy`,
    createdAt: new Date().toISOString(),
    resolvedAt: new Date().toISOString(),
  });

  const matches = repo.hasApprovalGrant({
    organizationId: orgId,
    requestedBy: 'agent-1',
    resourceType: 'shell',
    resourcePath: '/workspace',
    action: 'execute',
    approvalScope: 'shell:{"cwd":"/workspace","command":"git","args":["status"]}',
  });
  const mismatch = repo.hasApprovalGrant({
    organizationId: orgId,
    requestedBy: 'agent-1',
    resourceType: 'shell',
    resourcePath: '/workspace',
    action: 'execute',
    approvalScope: 'shell:{"cwd":"/workspace","command":"git","args":["log"]}',
  });

  expect(matches).toBe(true);
  expect(mismatch).toBe(false);
});

test('listPendingApprovals enriches threadId from parent run when DB row has no thread_id', () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  const now = new Date().toISOString();
  const runId = randomUUID();
  const threadId = `thread-${randomUUID()}`;

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Thread Org',
      workspace: { root: '/tmp/thread-org', roleScopes: {} },
    }),
  );

  repo.saveRun(
    RunStateSchema.parse({
      id: runId,
      organizationId: orgId,
      agentId: 'agent-1',
      threadId,
      status: 'running',
      step: 'running',
      summary: 'busy',
      startedAt: now,
    }),
  );

  repo.saveApproval(
    ApprovalRequestSchema.parse({
      id: randomUUID(),
      organizationId: orgId,
      runId,
      toolCallId: randomUUID(),
      requestedBy: 'agent-1',
      resourceType: 'shell',
      resourcePath: '/tmp',
      action: 'execute',
      status: 'pending',
      reason: 'scope=test',
      createdAt: now,
    }),
  );

  const pending = repo.listPendingApprovals(orgId);
  expect(pending).toHaveLength(1);
  expect(pending[0]?.threadId).toBe(threadId);
});

// Regression for two listChannels() bugs:
//   (A) Pagination drift — filtering self/dm in JS *after* paging meant
//       hasMore/nextCursor were computed against the unfiltered set, so once
//       hidden channels existed the cursor could point at a hidden row and
//       skip visible ones.
//   (B) DM leak — only `self` was being filtered, so `dm` channels surfaced
//       in BootstrapService and SettingsService payloads (callers without a
//       member identity could see private 2-member conversations).
// `saveChannel` stamps `created_at` with `Date.now()` ISO precision. Two
// adjacent saves can land on the same millisecond — and SQLite gives no
// guaranteed tiebreaker for same-timestamp rows under `ORDER BY created_at
// DESC`. Use a 2ms gap so insert order maps deterministically to sort order.
async function saveChannelAt(
  repo: Repository,
  channel: Parameters<Repository['saveChannel']>[0],
): Promise<void> {
  repo.saveChannel(channel);
  await new Promise((resolve) => setTimeout(resolve, 2));
}

test('listChannels excludes hidden kinds at the SQL layer (no pagination drift)', async () => {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Pagination Org',
      workspace: { root: '/tmp/pagination-org', roleScopes: {} },
    }),
  );

  // Insert order (oldest → newest): general, frontend, self_alex, dm_alex_quinn, backend.
  // `ORDER BY created_at DESC` → backend, dm_alex_quinn, self_alex, frontend, general.
  // After excluding self/dm at the SQL layer → backend, frontend, general.
  await saveChannelAt(repo, { id: 'general', organizationId: orgId, name: 'general', kind: 'general', topic: '', memberIds: [] });
  await saveChannelAt(repo, { id: 'frontend', organizationId: orgId, name: 'frontend', kind: 'group', topic: '', memberIds: [] });
  await saveChannelAt(repo, { id: 'self_alex', organizationId: orgId, name: 'self_alex', kind: 'self', topic: '', memberIds: ['alex'] });
  await saveChannelAt(repo, { id: 'dm_alex_quinn', organizationId: orgId, name: 'dm_alex_quinn', kind: 'dm', topic: '', memberIds: ['alex', 'quinn'] });
  await saveChannelAt(repo, { id: 'backend', organizationId: orgId, name: 'backend', kind: 'group', topic: '', memberIds: [] });

  // limit=2 must return exactly two visible rows and signal hasMore=true (one
  // more visible row remains). Pre-fix the limit-2 query returned
  // backend+dm_alex_quinn, drop dm_alex_quinn post-filter, and reported a
  // cursor pointing at a hidden row — skipping `self_alex` then revealing
  // `frontend` on page 2 instead of `frontend, general`.
  const page1 = repo.listChannels(orgId, undefined, 2, ['self', 'dm']);
  expect(page1.data.map((c) => c.id)).toEqual(['backend', 'frontend']);
  expect(page1.hasMore).toBe(true);
  expect(page1.nextCursor).toBeDefined();

  const page2 = repo.listChannels(orgId, page1.nextCursor, 2, ['self', 'dm']);
  expect(page2.data.map((c) => c.id)).toEqual(['general']);
  expect(page2.hasMore).toBe(false);

  // Sanity: nothing across both pages is a self/dm channel.
  const allReturned = [...page1.data, ...page2.data];
  expect(allReturned.every((c) => c.kind !== 'self' && c.kind !== 'dm')).toBe(true);
});

test('bootstrap snapshot drops self and dm channels', async () => {
  const { getBootstrapSnapshot } = await import('./bootstrap.js');
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();

  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Snapshot Org',
      workspace: { root: '/tmp/snapshot-org', roleScopes: {} },
    }),
  );
  repo.saveChannel({ id: 'general', organizationId: orgId, name: 'general', kind: 'general', topic: '', memberIds: [] });
  repo.saveChannel({ id: 'self_alex', organizationId: orgId, name: 'self_alex', kind: 'self', topic: '', memberIds: ['alex'] });
  repo.saveChannel({ id: 'dm_alex_quinn', organizationId: orgId, name: 'dm_alex_quinn', kind: 'dm', topic: '', memberIds: ['alex', 'quinn'] });

  const snapshot = getBootstrapSnapshot(db);
  const visibleIds = snapshot.channels.map((c) => c.id);
  expect(visibleIds).toContain('general');
  expect(visibleIds).not.toContain('self_alex');
  expect(visibleIds).not.toContain('dm_alex_quinn');
});

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

  repo.setChannelMembers('general', ['ava']);
  const mirroredThreadMembers = db
    .prepare('SELECT member_id FROM thread_members WHERE thread_id = ? ORDER BY member_id ASC')
    .all('general') as { member_id: string }[];
  expect(mirroredThreadMembers.map((row) => row.member_id)).toEqual(['ava']);

  db.prepare('DELETE FROM channel_members WHERE channel_id = ?').run('general');
  db.prepare('INSERT INTO channel_members (channel_id, member_id) VALUES (?, ?)').run('general', 'phoebe');

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

test('listChannels preserves channels that share the same created_at across page boundaries', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Cursor Channels Org',
      workspace: { root: '/tmp/cursor-channels-org', roleScopes: {} },
    }),
  );

  // Three group channels saved in the same tight loop — high probability
  // that all three land on the same millisecond. We force the issue by
  // bypassing saveChannel and writing the row with an explicit timestamp.
  // (saveChannel uses `now()` internally, but we want the assertion to be
  // deterministic, not probabilistic.)
  for (const id of ['ch-a', 'ch-b', 'ch-c']) {
    db.prepare(
      `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at, parent_message_id, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, orgId, id, 'group', '', '2026-04-27T08:00:00.000Z', '2026-04-27T08:00:00.000Z', null, null);
  }

  const page1 = repo.listChannels(orgId, undefined, 2);
  expect(page1.data).toHaveLength(2);
  expect(page1.hasMore).toBe(true);

  const page2 = repo.listChannels(orgId, page1.nextCursor, 2);
  expect(page2.data).toHaveLength(1);
  expect(page2.hasMore).toBe(false);

  const allIds = [...page1.data.map((c) => c.id), ...page2.data.map((c) => c.id)].sort();
  expect(allIds).toEqual(['ch-a', 'ch-b', 'ch-c']);
});

test('listChannels returns descending pages without overlap across three pages', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Three Page Org',
      workspace: { root: '/tmp/three-page-org', roleScopes: {} },
    }),
  );

  const createdAt = [
    '2026-04-27T08:00:05.000Z',
    '2026-04-27T08:00:04.000Z',
    '2026-04-27T08:00:03.000Z',
    '2026-04-27T08:00:02.000Z',
    '2026-04-27T08:00:01.000Z',
  ];

  for (const [index, id] of ['ch-5', 'ch-4', 'ch-3', 'ch-2', 'ch-1'].entries()) {
    db.prepare(
      `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at, parent_message_id, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, orgId, id, 'group', '', createdAt[index], createdAt[index], null, null);
  }

  const page1 = repo.listChannels(orgId, undefined, 2);
  expect(page1.data.map((channel) => channel.id)).toEqual(['ch-5', 'ch-4']);
  expect(page1.hasMore).toBe(true);
  expect(page1.nextCursor).toBeDefined();

  const page2 = repo.listChannels(orgId, page1.nextCursor, 2);
  expect(page2.data.map((channel) => channel.id)).toEqual(['ch-3', 'ch-2']);
  expect(page2.hasMore).toBe(true);
  expect(page2.nextCursor).toBeDefined();

  const page3 = repo.listChannels(orgId, page2.nextCursor, 2);
  expect(page3.data.map((channel) => channel.id)).toEqual(['ch-1']);
  expect(page3.hasMore).toBe(false);

  const allIds = [...page1.data, ...page2.data, ...page3.data].map((channel) => channel.id);
  expect(allIds).toEqual(['ch-5', 'ch-4', 'ch-3', 'ch-2', 'ch-1']);
  expect(new Set(allIds).size).toBe(allIds.length);
});

test('listChannels paginates correctly when the boundary id contains a pipe', () => {
  const db = openDatabase({ dbPath: ':memory:' });
  const repo = new Repository(db);
  const orgId = randomUUID();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'Pipe Cursor Org',
      workspace: { root: '/tmp/pipe-cursor-org', roleScopes: {} },
    }),
  );

  const rows = [
    ['zeta', '2026-04-27T08:00:03.000Z'],
    ['ops|infra', '2026-04-27T08:00:02.000Z'],
    ['alpha', '2026-04-27T08:00:01.000Z'],
  ] as const;

  for (const [id, createdAt] of rows) {
    db.prepare(
      `INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at, parent_message_id, archived_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, orgId, id, 'group', '', createdAt, createdAt, null, null);
  }

  const page1 = repo.listChannels(orgId, undefined, 2);
  expect(page1.data.map((channel) => channel.id)).toEqual(['zeta', 'ops|infra']);
  expect(page1.hasMore).toBe(true);
  expect(page1.nextCursor).toBeDefined();

  const page2 = repo.listChannels(orgId, page1.nextCursor, 2);
  expect(page2.data.map((channel) => channel.id)).toEqual(['alpha']);
  expect(page2.hasMore).toBe(false);
});
