import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { normalizeProviderKey } from '@ujima/framework';
import { OrganizationSchema, type Organization } from '@ujima/shared';
import { now, parseJsonObject, rowString } from './common.js';

type Row = Record<string, unknown>;

function providerRows(db: DbHandle, organizationId: string): Row[] {
  return db
    .prepare('SELECT provider_name, key_ref FROM provider_credentials WHERE organization_id = ?')
    .all(organizationId) as Row[];
}

export function getOrganization(db: DbHandle, organizationId: string): Organization | null {
  const row = db
    .prepare('SELECT * FROM organizations WHERE id = ?')
    .get(organizationId) as Row | null;
  if (!row) {
    return null;
  }

  let organizationChart = { reportsTo: {} as Record<string, string> };
  try {
    organizationChart = JSON.parse(
      rowString(row, 'organization_chart_json'),
    ) as Organization['organizationChart'];
  } catch {
    organizationChart = { reportsTo: {} };
  }

  return OrganizationSchema.parse({
    id: rowString(row, 'id'),
    name: rowString(row, 'name'),
    workspace: {
      root: rowString(row, 'workspace_root'),
      roleScopes: parseJsonObject(row.workspace_role_scopes),
    },
    organizationChart,
  });
}

export function getLatestOrganization(db: DbHandle): Organization | null {
  const row = db
    .prepare('SELECT id FROM organizations ORDER BY updated_at DESC LIMIT 1')
    .get() as Row | null;
  if (!row) {
    return null;
  }
  return getOrganization(db, rowString(row, 'id'));
}

export function listOrganizations(db: DbHandle): Organization[] {
  const rows = db
    .prepare('SELECT id FROM organizations ORDER BY updated_at DESC')
    .all() as Row[];
  const result: Organization[] = [];
  for (const row of rows) {
    const org = getOrganization(db, rowString(row, 'id'));
    if (org) result.push(org);
  }
  return result;
}

export function listOrganizationsForUser(db: DbHandle, emailNormalized: string): Organization[] {
  const rows = db
    .prepare(
      `SELECT o.id FROM organizations o
       INNER JOIN auth_users u ON u.organization_id = o.id
       WHERE u.email_normalized = ?
       ORDER BY o.updated_at DESC`,
    )
    .all(emailNormalized) as Row[];
  const result: Organization[] = [];
  for (const row of rows) {
    const org = getOrganization(db, rowString(row, 'id'));
    if (org) result.push(org);
  }
  return result;
}

export function saveOrganization(db: DbHandle, organization: Organization): Organization {
  const timestamp = now();
  db.prepare(
    `INSERT INTO organizations (id, name, workspace_root, workspace_role_scopes, organization_chart_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       workspace_root = excluded.workspace_root,
       workspace_role_scopes = excluded.workspace_role_scopes,
       organization_chart_json = excluded.organization_chart_json,
       updated_at = excluded.updated_at`,
  ).run(
    organization.id,
    organization.name,
    organization.workspace.root,
    JSON.stringify(organization.workspace.roleScopes),
    JSON.stringify(organization.organizationChart ?? { reportsTo: {} }),
    timestamp,
    timestamp,
  );

  return organization;
}

export function saveProviderCredential(
  db: DbHandle,
  organizationId: string,
  providerName: string,
  keyRef: string,
): void {
  const normalizedName = normalizeProviderKey(providerName);
  for (const row of providerRows(db, organizationId)) {
    if (normalizeProviderKey(rowString(row, 'provider_name')) !== normalizedName) continue;
    db.prepare('DELETE FROM provider_credentials WHERE organization_id = ? AND provider_name = ?')
      .run(organizationId, rowString(row, 'provider_name'));
  }

  db.prepare(
    `INSERT INTO provider_credentials (organization_id, provider_name, key_ref, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(organization_id, provider_name) DO UPDATE SET
       key_ref = excluded.key_ref,
       updated_at = excluded.updated_at`,
  ).run(organizationId, normalizedName, keyRef, now());
}

export function listProviderCredentials(
  db: DbHandle,
  organizationId: string,
): Record<string, boolean> {
  const rows = providerRows(db, organizationId);

  return Object.fromEntries(rows.map((row) => [normalizeProviderKey(rowString(row, 'provider_name')), true]));
}

export function getProviderCredential(
  db: DbHandle,
  organizationId: string,
  providerName: string,
): string | null {
  const normalizedName = normalizeProviderKey(providerName);
  const row = providerRows(db, organizationId).find(
    (entry) => normalizeProviderKey(rowString(entry, 'provider_name')) === normalizedName,
  );

  return row ? rowString(row, 'key_ref') : null;
}

export function deleteProviderCredential(
  db: DbHandle,
  organizationId: string,
  providerName: string,
): void {
  const normalizedName = normalizeProviderKey(providerName);
  for (const row of providerRows(db, organizationId)) {
    if (normalizeProviderKey(rowString(row, 'provider_name')) !== normalizedName) continue;
    db.prepare('DELETE FROM provider_credentials WHERE organization_id = ? AND provider_name = ?')
      .run(organizationId, rowString(row, 'provider_name'));
  }
}

export function saveWorkspaceSetting(
  db: DbHandle,
  organizationId: string,
  key: string,
  value: string,
): void {
  db.prepare(
    `INSERT INTO workspace_settings (organization_id, key, value, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(organization_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(organizationId, key, value, now());
}

export function getWorkspaceSetting(
  db: DbHandle,
  organizationId: string,
  key: string,
): string | null {
  const row = db
    .prepare(
      'SELECT value FROM workspace_settings WHERE organization_id = ? AND key = ?',
    )
    .get(organizationId, key) as Row | null;

  return row ? rowString(row, 'value') : null;
}

export function findOrganizationIdByWorkspaceSetting(
  db: DbHandle,
  key: string,
  value: string,
): string | null {
  const row = db
    .prepare(
      'SELECT organization_id FROM workspace_settings WHERE key = ? AND value = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(key, value) as Row | null;

  return row ? rowString(row, 'organization_id') : null;
}
