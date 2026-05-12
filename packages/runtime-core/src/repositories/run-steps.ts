import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { RunStepSchema, type RunStep } from '@ujima/shared';
import { optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

export function saveRunStep(db: DbHandle, step: RunStep): RunStep {
  const payload = RunStepSchema.parse(step);

  db.prepare(
    `INSERT INTO run_steps (
      id, organization_id, run_id, thread_id, agent_id, tool_call_id, tool_id,
      action, resource_type, resource_path, input, output, status, created_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       output = excluded.output,
       status = excluded.status`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.runId,
    payload.threadId ?? null,
    payload.agentId,
    payload.toolCallId,
    payload.toolId,
    payload.action,
    payload.resourceType,
    payload.resourcePath,
    JSON.stringify(payload.input),
    payload.output === undefined ? null : JSON.stringify(payload.output),
    payload.status,
    payload.createdAt,
  );

  return payload;
}

export function listRunSteps(
  db: DbHandle,
  organizationId: string,
  runId: string,
): RunStep[] {
  const rows = db
    .prepare(
      `SELECT * FROM run_steps
       WHERE organization_id = ? AND run_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(organizationId, runId) as Row[];

  return rows.map(rowToRunStep);
}

function rowToRunStep(row: Row): RunStep {
  return RunStepSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    runId: rowString(row, 'run_id'),
    threadId: optionalRowString(row, 'thread_id'),
    agentId: rowString(row, 'agent_id'),
    toolCallId: rowString(row, 'tool_call_id'),
    toolId: rowString(row, 'tool_id'),
    action: rowString(row, 'action'),
    resourceType: rowString(row, 'resource_type'),
    resourcePath: rowString(row, 'resource_path'),
    input: parseJsonObject(row.input),
    output: parseJson(row.output),
    status: rowString(row, 'status'),
    createdAt: rowString(row, 'created_at'),
  });
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return JSON.parse(value);
}
