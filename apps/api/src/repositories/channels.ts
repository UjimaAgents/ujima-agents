import type { Database } from "bun:sqlite";
import { ChannelSchema, type Channel } from "@ujima/shared";
import { now, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveChannel(db: Database, channel: Channel): Channel {
  const payload = ChannelSchema.parse(channel);

  db.run(
    `
    INSERT INTO channels (id, organization_id, name, kind, topic, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      topic = excluded.topic,
      updated_at = excluded.updated_at
    `,
    [payload.id as string, payload.organizationId as string, payload.name, payload.kind, payload.topic ?? "", now(), now()],
  );

  return payload;
}

export function getChannel(db: Database, organizationId: string, channelId: string): Channel | null {
  const row = db.query("SELECT * FROM channels WHERE organization_id = ? AND id = ?").get(
    organizationId,
    channelId,
  ) as Row | null;

  if (!row) {
    return null;
  }

  return ChannelSchema.parse({
    id: rowString(row, "id"),
    organizationId: rowString(row, "organization_id"),
    name: rowString(row, "name"),
    kind: rowString(row, "kind"),
    topic: rowString(row, "topic"),
    memberIds: listChannelMemberIds(db, rowString(row, "id")),
  });
}

export function listChannels(db: Database, organizationId: string): Channel[] {
  const rows = db.query("SELECT * FROM channels WHERE organization_id = ? ORDER BY created_at ASC").all(
    organizationId,
  ) as Row[];

  return rows.map((row) =>
    ChannelSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      name: rowString(row, "name"),
      kind: rowString(row, "kind"),
      topic: rowString(row, "topic"),
      memberIds: listChannelMemberIds(db, rowString(row, "id")),
    }),
  );
}

export function setChannelMembers(db: Database, channelId: string, memberIds: string[]) {
  db.run("DELETE FROM channel_members WHERE channel_id = ?", [channelId]);
  for (const memberId of memberIds) {
    db.run("INSERT INTO channel_members (channel_id, member_id) VALUES (?, ?)", [channelId, memberId]);
  }
}

export function listChannelMemberIds(db: Database, channelId: string): string[] {
  const rows = db.query("SELECT member_id FROM channel_members WHERE channel_id = ? ORDER BY member_id ASC").all(
    channelId,
  ) as Array<{ member_id: string }>;

  return rows.map((row) => row.member_id);
}

