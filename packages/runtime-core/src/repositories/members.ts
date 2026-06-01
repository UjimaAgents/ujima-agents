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
    llm: optionalRowString(row, 'llm'),
    model: optionalRowString(row, 'model'),
    shellApprovalMode: optionalRowString(row, 'shell_approval_mode'),
    presence: rowString(row, 'presence'),
    createdAt: optionalRowString(row, 'created_at'),
    retiredAt: optionalRowString(row, 'retired_at'),
  });
}

export function saveMember(db: DbHandle, member: Member): Member {
  const payload = MemberSchema.parse(member);
  const timestamp = now();

  db.prepare(
    `INSERT INTO members (id, organization_id, name, kind, role_name, llm, model, shell_approval_mode, presence, created_at, updated_at, retired_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       role_name = excluded.role_name,
       llm = excluded.llm,
       model = excluded.model,
       shell_approval_mode = excluded.shell_approval_mode,
       presence = excluded.presence,
       retired_at = excluded.retired_at,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.name,
    payload.kind,
    payload.roleName,
    payload.llm ?? null,
    payload.model ?? null,
    payload.shellApprovalMode ?? null,
    payload.presence,
    payload.createdAt ?? timestamp,
    timestamp,
    payload.retiredAt ?? null,
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
