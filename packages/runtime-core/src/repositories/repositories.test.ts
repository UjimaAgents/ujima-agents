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
