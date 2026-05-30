import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { normalizeProviderKey } from '@ujima/framework';
import { OrganizationSchema, type Organization } from '@ujima/shared';
import { resolve } from 'node:path';
import { now, parseJsonObject, rowString } from './common.js';

type Row = Record<string, unknown>;

function providerRows(db: DbHandle, organizationId: string): Row[] {
  return db
    .prepare('SELECT provider_name, key_ref FROM provider_credentials WHERE organization_id = ?')
    .all(organizationId) as Row[];
}

function upsertWorkspaceRow(db: DbHandle, organization: Organization, timestamp: number): void {
  db.prepare(
    `INSERT INTO workspaces (id, root_path, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       root_path = excluded.root_path,
       label = excluded.label,
       updated_at = excluded.updated_at`,
  ).run(
    `ws_${organization.id}`,
    resolve(organization.workspace.root.trim()),
    organization.name.trim() || 'Workspace',
    timestamp,
    timestamp,
  );
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

/** Organizations that have at least one owner login (excludes failed/partial onboarding). */
export function organizationHasAuthUsers(db: DbHandle, organizationId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS n FROM auth_users WHERE organization_id = ? LIMIT 1')
    .get(organizationId) as { n: number } | null | undefined;
  return row != null;
}

export function listOrganizationsWithSignIn(db: DbHandle): Organization[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT o.id FROM organizations o
       INNER JOIN auth_users u ON u.organization_id = o.id
       ORDER BY o.updated_at DESC`,
    )
    .all() as Row[];
  const result: Organization[] = [];
  for (const row of rows) {
    const org = getOrganization(db, rowString(row, 'id'));
    if (org) result.push(org);
  }
  return result;
}

/** Removes org data created during onboarding when credential registration fails afterward. */
export function deleteOrganizationData(db: DbHandle, organizationId: string): void {
  const run = (sql: string, ...params: unknown[]) => {
    db.prepare(sql).run(...params);
  };

  db.exec('BEGIN');
  try {
    run('DELETE FROM auth_sessions WHERE organization_id = ?', organizationId);
    run('DELETE FROM auth_users WHERE organization_id = ?', organizationId);
    run('DELETE FROM conversation_reads WHERE organization_id = ?', organizationId);
    run(
      'DELETE FROM channel_members WHERE channel_id IN (SELECT id FROM channels WHERE organization_id = ?)',
      organizationId,
    );
    run('DELETE FROM channels WHERE organization_id = ?', organizationId);
    run(
      'DELETE FROM thread_members WHERE thread_id IN (SELECT id FROM threads WHERE organization_id = ?)',
      organizationId,
    );
    run('DELETE FROM threads WHERE organization_id = ?', organizationId);
    run(
      'DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE organization_id = ?)',
      organizationId,
    );
    run(
      'DELETE FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE organization_id = ?)',
      organizationId,
    );
    run('DELETE FROM messages WHERE organization_id = ?', organizationId);
    run('DELETE FROM runs WHERE organization_id = ?', organizationId);
    run('DELETE FROM run_steps WHERE organization_id = ?', organizationId);
    run('DELETE FROM approvals WHERE organization_id = ?', organizationId);
    run('DELETE FROM audit_events WHERE organization_id = ?', organizationId);
    run('DELETE FROM memory_entries WHERE organization_id = ?', organizationId);
    run('DELETE FROM tool_activity WHERE organization_id = ?', organizationId);
    run('DELETE FROM todos WHERE organization_id = ?', organizationId);
    run('DELETE FROM provider_bindings WHERE organization_id = ?', organizationId);
    run('DELETE FROM task_sessions WHERE organization_id = ?', organizationId);
    run('DELETE FROM spirits WHERE organization_id = ?', organizationId);
    run('DELETE FROM attachments WHERE organization_id = ?', organizationId);
    run('DELETE FROM mcp_servers WHERE organization_id = ?', organizationId);
    run('DELETE FROM agent_mcp_attachments WHERE organization_id = ?', organizationId);
    run('DELETE FROM mcp_tool_cache WHERE organization_id = ?', organizationId);
    run('DELETE FROM scheduled_jobs WHERE organization_id = ?', organizationId);
    run('DELETE FROM workspace_files WHERE organization_id = ?', organizationId);
    run('DELETE FROM decision_log WHERE organization_id = ?', organizationId);
    run('DELETE FROM procedure_revisions WHERE organization_id = ?', organizationId);
    run('DELETE FROM run_procedures_applied WHERE organization_id = ?', organizationId);
    run('DELETE FROM workspace_members WHERE organization_id = ?', organizationId);
    run('DELETE FROM members WHERE organization_id = ?', organizationId);
    run('DELETE FROM provider_credentials WHERE organization_id = ?', organizationId);
    run('DELETE FROM workspace_settings WHERE organization_id = ?', organizationId);
    run('DELETE FROM config_field_ownership WHERE organization_id = ?', organizationId);
    run('DELETE FROM workspaces WHERE id = ?', `ws_${organizationId}`);
    run('DELETE FROM organizations WHERE id = ?', organizationId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function saveOrganization(db: DbHandle, organization: Organization): Organization {
  const timestamp = now();
  const workspaceTimestamp = Date.now();
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
  upsertWorkspaceRow(db, organization, workspaceTimestamp);

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

export function deleteWorkspaceSetting(
  db: DbHandle,
  organizationId: string,
  key: string,
): void {
  db.prepare('DELETE FROM workspace_settings WHERE organization_id = ? AND key = ?').run(
    organizationId,
    key,
  );
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
