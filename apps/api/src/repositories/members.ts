import type { Database } from "bun:sqlite";
import { MemberSchema, type Member } from "@ujima/shared";
import { now, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveMember(db: Database, member: Member): Member {
  const payload = MemberSchema.parse({
    ...member,
    presence: member.presence ?? "offline",
  });

  db.run(
    `
    INSERT INTO members (id, organization_id, name, kind, role_name, presence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      role_name = excluded.role_name,
      presence = excluded.presence,
      updated_at = excluded.updated_at
    `,
    [
      payload.id,
      payload.organizationId,
      payload.name,
      payload.kind,
      payload.roleName,
      payload.presence,
      payload.createdAt ?? now(),
      now(),
    ],
  );

  return payload;
}

export function getMember(db: Database, organizationId: string, memberId: string): Member | null {
  const row = db.query("SELECT * FROM members WHERE organization_id = ? AND id = ?").get(
    organizationId,
    memberId,
  ) as Row | null;

  if (!row) {
    return null;
  }

  return MemberSchema.parse({
    id: rowString(row, "id"),
    organizationId: rowString(row, "organization_id"),
    name: rowString(row, "name"),
    kind: rowString(row, "kind"),
    roleName: rowString(row, "role_name"),
    presence: rowString(row, "presence"),
    createdAt: rowString(row, "created_at"),
  });
}

export function listMembers(db: Database, organizationId: string): Member[] {
  const rows = db.query("SELECT * FROM members WHERE organization_id = ? ORDER BY created_at ASC").all(
    organizationId,
  ) as Row[];

  return rows.map((row) =>
    MemberSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      name: rowString(row, "name"),
      kind: rowString(row, "kind"),
      roleName: rowString(row, "role_name"),
      presence: rowString(row, "presence"),
      createdAt: rowString(row, "created_at"),
    }),
  );
}
