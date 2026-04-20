import type { Database } from "bun:sqlite";
import { RunStateSchema, type RunState } from "@ujima/shared";
import { now, optionalRowString, rowString } from "./common.ts";

type Row = Record<string, unknown>;

export function saveRun(db: Database, run: RunState): RunState {
  const payload = RunStateSchema.parse(run);

  db.run(
    `
    INSERT INTO runs (id, organization_id, agent_id, thread_id, status, step, summary, started_at, ended_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      step = excluded.step,
      summary = excluded.summary,
      ended_at = excluded.ended_at
    `,
    [
      payload.id,
      payload.organizationId,
      payload.agentId,
      payload.threadId ?? null,
      payload.status,
      payload.step,
      payload.summary,
      payload.startedAt,
      payload.endedAt ?? null,
    ],
  );

  return payload;
}

export function getRun(db: Database, organizationId: string, runId: string): RunState | null {
  const row = db.query("SELECT * FROM runs WHERE organization_id = ? AND id = ?").get(
    organizationId,
    runId,
  ) as Row | null;

  if (!row) {
    return null;
  }

  return RunStateSchema.parse({
    id: rowString(row, "id"),
    organizationId: rowString(row, "organization_id"),
    agentId: rowString(row, "agent_id"),
    threadId: optionalRowString(row, "thread_id"),
    status: rowString(row, "status"),
    step: rowString(row, "step"),
    summary: rowString(row, "summary"),
    startedAt: rowString(row, "started_at"),
    endedAt: optionalRowString(row, "ended_at"),
  });
}

export function listRuns(
  db: Database,
  organizationId: string,
  cursor?: string,
  limit: number = 50,
): { data: RunState[]; nextCursor?: string; hasMore: boolean } {
  let query = "SELECT * FROM runs WHERE organization_id = ?";
  const params: any[] = [organizationId];

  if (cursor) {
    query += " AND started_at < ?";
    params.push(cursor);
  }

  query += " ORDER BY started_at DESC LIMIT ?";
  params.push(limit + 1);

  const rows = db.query(query).all(...params) as Row[];

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const data = rows.map((row) =>
    RunStateSchema.parse({
      id: rowString(row, "id"),
      organizationId: rowString(row, "organization_id"),
      agentId: rowString(row, "agent_id"),
      threadId: optionalRowString(row, "thread_id"),
      status: rowString(row, "status"),
      step: rowString(row, "step"),
      summary: rowString(row, "summary"),
      startedAt: rowString(row, "started_at"),
      endedAt: optionalRowString(row, "ended_at"),
    }),
  );

  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1].startedAt : undefined;

  return { data, hasMore, nextCursor };
}
