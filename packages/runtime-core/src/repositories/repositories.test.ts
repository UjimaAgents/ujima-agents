import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { OrganizationSchema } from '@ujima/shared';
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
