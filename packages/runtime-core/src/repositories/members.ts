import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { MemberSchema, type Member } from '@ujima/shared';
import { now, optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

function rowToMember(row: Row): Member {
  return MemberSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    name: rowString(row, 'name'),
    kind: rowString(row, 'kind'),
    roleName: rowString(row, 'role_name'),
    presence: rowString(row, 'presence'),
    createdAt: optionalRowString(row, 'created_at'),
  });
}

export function saveMember(db: DbHandle, member: Member): Member {
  const payload = MemberSchema.parse(member);
  const timestamp = now();

  db.prepare(
    `INSERT INTO members (id, organization_id, name, kind, role_name, presence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       role_name = excluded.role_name,
       presence = excluded.presence,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.name,
    payload.kind,
    payload.roleName,
    payload.presence,
    payload.createdAt ?? timestamp,
    timestamp,
  );

  return payload;
}

export function getMember(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): Member | null {
  const row = db
    .prepare('SELECT * FROM members WHERE organization_id = ? AND id = ?')
    .get(organizationId, memberId) as Row | null;

  return row ? rowToMember(row) : null;
}

export function listMembers(db: DbHandle, organizationId: string): Member[] {
  const rows = db
    .prepare('SELECT * FROM members WHERE organization_id = ? ORDER BY created_at ASC')
    .all(organizationId) as Row[];

  return rows.map(rowToMember);
}
