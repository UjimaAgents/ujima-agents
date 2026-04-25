import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { WorkspaceMemberSchema, type WorkspaceMember } from '@ujima/shared';
import { now, optionalRowString, parseJsonArray, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToWorkspaceMember(row: Row): WorkspaceMember {
  return WorkspaceMemberSchema.parse({
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    roleScopePaths: parseJsonArray(row.role_scope_paths).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
    createdAt: optionalRowString(row, 'created_at'),
    updatedAt: optionalRowString(row, 'updated_at'),
  });
}

export function saveWorkspaceMember(
  db: DbHandle,
  workspaceMember: WorkspaceMember,
): WorkspaceMember {
  const payload = WorkspaceMemberSchema.parse(workspaceMember);
  const timestamp = now();

  db.prepare(
    `INSERT INTO workspace_members (organization_id, member_id, role_scope_paths, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, member_id) DO UPDATE SET
       role_scope_paths = excluded.role_scope_paths,
       updated_at = excluded.updated_at`,
  ).run(
    payload.organizationId,
    payload.memberId,
    JSON.stringify(payload.roleScopePaths),
    payload.createdAt ?? timestamp,
    timestamp,
  );

  return WorkspaceMemberSchema.parse({
    ...payload,
    createdAt: payload.createdAt ?? timestamp,
    updatedAt: timestamp,
  });
}

export function getWorkspaceMember(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): WorkspaceMember | null {
  const row = db
    .prepare(
      'SELECT * FROM workspace_members WHERE organization_id = ? AND member_id = ?',
    )
    .get(organizationId, memberId) as Row | null;

  return row ? rowToWorkspaceMember(row) : null;
}

export function listWorkspaceMembers(db: DbHandle, organizationId: string): WorkspaceMember[] {
  const rows = db
    .prepare(
      'SELECT * FROM workspace_members WHERE organization_id = ? ORDER BY created_at ASC',
    )
    .all(organizationId) as Row[];

  return rows.map(rowToWorkspaceMember);
}
