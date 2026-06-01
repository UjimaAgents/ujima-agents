import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { now, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface GovernanceRuleRow {
  id: string;
  organizationId: string;
  agentId: string;
  mcpId: string;
  toolName: string;
  state: string;
  reason: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

function rowToRule(row: Row): GovernanceRuleRow {
  return {
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    agentId: rowString(row, 'agent_id'),
    mcpId: rowString(row, 'mcp_id'),
    toolName: rowString(row, 'tool_name'),
    state: rowString(row, 'state'),
    reason: (row.reason as string) ?? null,
    updatedAt: rowString(row, 'updated_at'),
    updatedBy: (row.updated_by as string) ?? null,
  };
}

/**
 * List all governance rules for an organization, optionally filtered by state.
 */
export function listGovernanceRules(
  db: DbHandle,
  organizationId: string,
  state?: string,
): GovernanceRuleRow[] {
  const sql = state
    ? 'SELECT * FROM governance_rules WHERE organization_id = ? AND state = ? ORDER BY updated_at DESC'
    : 'SELECT * FROM governance_rules WHERE organization_id = ? ORDER BY updated_at DESC';
  const params = state ? [organizationId, state] : [organizationId];
  const rows = db.prepare(sql).all(...params) as Row[];
  return rows.map(rowToRule);
}

/**
 * Delete a governance rule by its unique (org, agent, mcp, tool) tuple.
 * Returns the deleted row or null if nothing matched.
 */
export function deleteGovernanceRule(
  db: DbHandle,
  organizationId: string,
  agentId: string,
  mcpId: string,
  toolName: string,
): GovernanceRuleRow | null {
  const row = db
    .prepare(
      'SELECT * FROM governance_rules WHERE organization_id = ? AND agent_id = ? AND mcp_id = ? AND tool_name = ?',
    )
    .get(organizationId, agentId, mcpId, toolName) as Row | null;
  if (!row) return null;

  db.prepare(
    'DELETE FROM governance_rules WHERE organization_id = ? AND agent_id = ? AND mcp_id = ? AND tool_name = ?',
  ).run(organizationId, agentId, mcpId, toolName);

  return rowToRule(row);
}

/**
 * Upsert a governance rule. Inserts or replaces on unique conflict.
 */
export function saveGovernanceRule(
  db: DbHandle,
  rule: {
    id: string;
    organizationId: string;
    agentId: string;
    mcpId: string;
    toolName: string;
    state: string;
    reason?: string;
    updatedBy?: string;
  },
): GovernanceRuleRow {
  const timestamp = now();
  db.prepare(
    `INSERT INTO governance_rules (id, organization_id, agent_id, mcp_id, tool_name, state, reason, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, agent_id, mcp_id, tool_name) DO UPDATE SET
       state = excluded.state,
       reason = excluded.reason,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
  ).run(
    rule.id,
    rule.organizationId,
    rule.agentId,
    rule.mcpId,
    rule.toolName,
    rule.state,
    rule.reason ?? null,
    timestamp,
    rule.updatedBy ?? null,
  );

  return {
    id: rule.id,
    organizationId: rule.organizationId,
    agentId: rule.agentId,
    mcpId: rule.mcpId,
    toolName: rule.toolName,
    state: rule.state,
    reason: rule.reason ?? null,
    updatedAt: timestamp,
    updatedBy: rule.updatedBy ?? null,
  };
}
