import type {SqliteDbHandle as DbHandle} from '@ujima/context-store';
import {
  normalizeWorkflowGraph,
  WorkflowDefinitionSchema,
  WorkflowNodeRunSchema,
  WorkflowRunSchema,
  type WorkflowDefinition,
  type WorkflowNodeRun,
  type WorkflowRun,
} from '@ujima/shared';
import {optionalRowString, rowString} from './common.js';

type Row = Record<string, unknown>;

// -- local numeric helpers (common.ts only ships string helpers) -----------

function rowNumber(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') {
    throw new Error(`Expected numeric column "${key}"`);
  }
  return value;
}

function optionalRowNumber(row: Row, key: string): number | undefined {
  const value = row[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Narrow port for workflow definitions + run/node-run state. The engine owns
 * the state machine (idempotency, status guards) via `repository.transaction`;
 * this store is plain CRUD.
 */
export interface WorkflowStore {
  saveWorkflowDefinition(def: WorkflowDefinition): WorkflowDefinition;
  getWorkflowDefinition(organizationId: string, id: string): WorkflowDefinition | null;
  getWorkflowDefinitionByName(
    organizationId: string,
    name: string,
  ): WorkflowDefinition | null;
  listWorkflowDefinitions(organizationId: string): WorkflowDefinition[];
  /** Workflows runnable in a channel: channel-scoped to it + org-wide (null channel). */
  listWorkflowDefinitionsForChannel(
    organizationId: string,
    channelId: string,
  ): WorkflowDefinition[];
  deleteWorkflowDefinition(organizationId: string, id: string): void;

  saveWorkflowRun(run: WorkflowRun): WorkflowRun;
  getWorkflowRun(organizationId: string, runId: string): WorkflowRun | null;
  listWorkflowRuns(organizationId: string, status?: string): WorkflowRun[];
  listWorkflowRunsByStatus(organizationId: string, statuses: string[]): WorkflowRun[];

  saveWorkflowNodeRun(nodeRun: WorkflowNodeRun): WorkflowNodeRun;
  getWorkflowNodeRun(workflowRunId: string, id: string): WorkflowNodeRun | null;
  getWorkflowNodeRunByNode(
    workflowRunId: string,
    nodeId: string,
    attempt: number,
  ): WorkflowNodeRun | null;
  /** Reverse lookup: the node run whose agent child run is `childRunId`. */
  getWorkflowNodeRunByChildRun(childRunId: string): WorkflowNodeRun | null;
  listWorkflowNodeRuns(workflowRunId: string): WorkflowNodeRun[];
}

// -- Definitions -----------------------------------------------------------

function rowToDefinition(row: Row): WorkflowDefinition {
  const graph = JSON.parse(rowString(row, 'graph_json')) as {
    nodes?: unknown;
    edges?: unknown;
  };
  const normalizedGraph = normalizeWorkflowGraph(graph);
  return WorkflowDefinitionSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    channelId: optionalRowString(row, 'channel_id') ?? null,
    name: rowString(row, 'name'),
    description: optionalRowString(row, 'description'),
    nodes: normalizedGraph.nodes,
    edges: normalizedGraph.edges,
    version: rowNumber(row, 'version'),
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveWorkflowDefinition(
  db: DbHandle,
  def: WorkflowDefinition,
): WorkflowDefinition {
  const payload = WorkflowDefinitionSchema.parse({
    ...def,
    ...normalizeWorkflowGraph({ nodes: def.nodes, edges: def.edges }),
  });
  const graphJson = JSON.stringify({nodes: payload.nodes, edges: payload.edges});
  db.prepare(
    `INSERT INTO workflow_definitions (
       id, organization_id, channel_id, name, description, graph_json, version, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       channel_id = excluded.channel_id,
       name = excluded.name,
       description = excluded.description,
       graph_json = excluded.graph_json,
       version = excluded.version,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.channelId ?? null,
    payload.name,
    payload.description ?? null,
    graphJson,
    payload.version,
    null,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getWorkflowDefinition(
  db: DbHandle,
  organizationId: string,
  id: string,
): WorkflowDefinition | null {
  const row = db
    .prepare('SELECT * FROM workflow_definitions WHERE organization_id = ? AND id = ?')
    .get(organizationId, id) as Row | null;
  return row ? rowToDefinition(row) : null;
}

export function getWorkflowDefinitionByName(
  db: DbHandle,
  organizationId: string,
  name: string,
): WorkflowDefinition | null {
  const row = db
    .prepare(
      'SELECT * FROM workflow_definitions WHERE organization_id = ? AND name = ? ORDER BY updated_at DESC LIMIT 1',
    )
    .get(organizationId, name) as Row | null;
  return row ? rowToDefinition(row) : null;
}

export function listWorkflowDefinitions(
  db: DbHandle,
  organizationId: string,
): WorkflowDefinition[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_definitions WHERE organization_id = ? ORDER BY name ASC',
    )
    .all(organizationId) as Row[];
  return rows.map(rowToDefinition);
}

export function listWorkflowDefinitionsForChannel(
  db: DbHandle,
  organizationId: string,
  channelId: string,
): WorkflowDefinition[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_definitions
       WHERE organization_id = ? AND (channel_id = ? OR channel_id IS NULL)
       ORDER BY channel_id IS NULL, name ASC`,
    )
    .all(organizationId, channelId) as Row[];
  return rows.map(rowToDefinition);
}

export function deleteWorkflowDefinition(
  db: DbHandle,
  organizationId: string,
  id: string,
): void {
  db.prepare(
    'DELETE FROM workflow_definitions WHERE organization_id = ? AND id = ?',
  ).run(organizationId, id);
}

// -- Runs ------------------------------------------------------------------

function rowToRun(row: Row): WorkflowRun {
  return WorkflowRunSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    definitionId: optionalRowString(row, 'workflow_definition_id') ?? null,
    name: rowString(row, 'name'),
    graphSnapshot: rowString(row, 'graph_snapshot'),
    graphSha256: rowString(row, 'graph_sha256'),
    input: optionalRowString(row, 'input_text') ?? null,
    status: rowString(row, 'status'),
    initiatedBy: rowString(row, 'initiated_by'),
    channelId: rowString(row, 'channel_id'),
    threadId: rowString(row, 'thread_id'),
    originThreadId: optionalRowString(row, 'origin_thread_id') ?? null,
    lastTransitionToken: optionalRowString(row, 'last_transition_token') ?? null,
    createdAt: rowString(row, 'created_at'),
    updatedAt: rowString(row, 'updated_at'),
  });
}

export function saveWorkflowRun(db: DbHandle, run: WorkflowRun): WorkflowRun {
  const payload = WorkflowRunSchema.parse(run);
  db.prepare(
    `INSERT INTO workflow_runs (
       id, organization_id, workflow_definition_id, name, graph_snapshot, graph_sha256,
       input_text, status, initiated_by, channel_id, thread_id, origin_thread_id,
       last_transition_token, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       last_transition_token = excluded.last_transition_token,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.definitionId ?? null,
    payload.name,
    payload.graphSnapshot,
    payload.graphSha256,
    payload.input ?? null,
    payload.status,
    payload.initiatedBy,
    payload.channelId,
    payload.threadId,
    payload.originThreadId ?? null,
    payload.lastTransitionToken ?? null,
    payload.createdAt,
    payload.updatedAt,
  );
  return payload;
}

export function getWorkflowRun(
  db: DbHandle,
  organizationId: string,
  runId: string,
): WorkflowRun | null {
  const row = db
    .prepare('SELECT * FROM workflow_runs WHERE organization_id = ? AND id = ?')
    .get(organizationId, runId) as Row | null;
  return row ? rowToRun(row) : null;
}

export function listWorkflowRuns(
  db: DbHandle,
  organizationId: string,
  status?: string,
): WorkflowRun[] {
  if (status) {
    const rows = db
      .prepare(
        'SELECT * FROM workflow_runs WHERE organization_id = ? AND status = ? ORDER BY updated_at DESC',
      )
      .all(organizationId, status) as Row[];
    return rows.map(rowToRun);
  }
  const rows = db
    .prepare(
      'SELECT * FROM workflow_runs WHERE organization_id = ? ORDER BY updated_at DESC',
    )
    .all(organizationId) as Row[];
  return rows.map(rowToRun);
}

export function listWorkflowRunsByStatus(
  db: DbHandle,
  organizationId: string,
  statuses: string[],
): WorkflowRun[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM workflow_runs
       WHERE organization_id = ? AND status IN (${placeholders})
       ORDER BY updated_at DESC`,
    )
    .all(organizationId, ...statuses) as Row[];
  return rows.map(rowToRun);
}

// -- Node runs -------------------------------------------------------------

function rowToNodeRun(row: Row): WorkflowNodeRun {
  const outputJsonRaw = optionalRowString(row, 'output_json');
  return WorkflowNodeRunSchema.parse({
    id: rowString(row, 'id'),
    workflowRunId: rowString(row, 'workflow_run_id'),
    nodeId: rowString(row, 'node_id'),
    attempt: rowNumber(row, 'attempt'),
    kind: rowString(row, 'kind'),
    agentId: optionalRowString(row, 'agent_id') ?? null,
    childRunId: optionalRowString(row, 'child_run_id') ?? null,
    outputPath: optionalRowString(row, 'output_path') ?? null,
    outputSha256: optionalRowString(row, 'output_sha256') ?? null,
    outputSizeBytes: optionalRowNumber(row, 'output_size_bytes') ?? null,
    outputJson: outputJsonRaw ? (JSON.parse(outputJsonRaw) as unknown) : undefined,
    summary: optionalRowString(row, 'summary') ?? null,
    approvalRequestId: optionalRowString(row, 'approval_request_id') ?? null,
    status: rowString(row, 'status'),
    failureReason: optionalRowString(row, 'failure_reason') ?? null,
    startedAt: optionalRowString(row, 'started_at') ?? null,
    completedAt: optionalRowString(row, 'completed_at') ?? null,
  });
}

export function saveWorkflowNodeRun(
  db: DbHandle,
  nodeRun: WorkflowNodeRun,
): WorkflowNodeRun {
  const payload = WorkflowNodeRunSchema.parse(nodeRun);
  const outputJson =
    payload.outputJson === undefined ? null : JSON.stringify(payload.outputJson);
  db.prepare(
    `INSERT INTO workflow_node_runs (
       id, workflow_run_id, node_id, attempt, kind, agent_id, child_run_id,
       output_path, output_sha256, output_size_bytes, output_json, summary,
       approval_request_id, status, failure_reason, started_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       agent_id = excluded.agent_id,
       child_run_id = excluded.child_run_id,
       output_path = excluded.output_path,
       output_sha256 = excluded.output_sha256,
       output_size_bytes = excluded.output_size_bytes,
       output_json = excluded.output_json,
       summary = excluded.summary,
       approval_request_id = excluded.approval_request_id,
       status = excluded.status,
       failure_reason = excluded.failure_reason,
       started_at = excluded.started_at,
       completed_at = excluded.completed_at`,
  ).run(
    payload.id,
    payload.workflowRunId,
    payload.nodeId,
    payload.attempt,
    payload.kind,
    payload.agentId ?? null,
    payload.childRunId ?? null,
    payload.outputPath ?? null,
    payload.outputSha256 ?? null,
    payload.outputSizeBytes ?? null,
    outputJson,
    payload.summary ?? null,
    payload.approvalRequestId ?? null,
    payload.status,
    payload.failureReason ?? null,
    payload.startedAt ?? null,
    payload.completedAt ?? null,
  );
  return payload;
}

export function getWorkflowNodeRun(
  db: DbHandle,
  workflowRunId: string,
  id: string,
): WorkflowNodeRun | null {
  const row = db
    .prepare('SELECT * FROM workflow_node_runs WHERE workflow_run_id = ? AND id = ?')
    .get(workflowRunId, id) as Row | null;
  return row ? rowToNodeRun(row) : null;
}

export function getWorkflowNodeRunByNode(
  db: DbHandle,
  workflowRunId: string,
  nodeId: string,
  attempt: number,
): WorkflowNodeRun | null {
  const row = db
    .prepare(
      'SELECT * FROM workflow_node_runs WHERE workflow_run_id = ? AND node_id = ? AND attempt = ?',
    )
    .get(workflowRunId, nodeId, attempt) as Row | null;
  return row ? rowToNodeRun(row) : null;
}

export function getWorkflowNodeRunByChildRun(
  db: DbHandle,
  childRunId: string,
): WorkflowNodeRun | null {
  const row = db
    .prepare(
      'SELECT * FROM workflow_node_runs WHERE child_run_id = ? ORDER BY attempt DESC LIMIT 1',
    )
    .get(childRunId) as Row | null;
  return row ? rowToNodeRun(row) : null;
}

export function listWorkflowNodeRuns(
  db: DbHandle,
  workflowRunId: string,
): WorkflowNodeRun[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_node_runs WHERE workflow_run_id = ? ORDER BY started_at ASC, id ASC',
    )
    .all(workflowRunId) as Row[];
  return rows.map(rowToNodeRun);
}
