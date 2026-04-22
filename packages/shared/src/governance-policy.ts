import { z } from 'zod';

export const ToolPolicyState = z.enum([
  'allow',
  'deny',
  'require_approval',
  'require_input',
  'inherit',
]);
export type ToolPolicyState = z.infer<typeof ToolPolicyState>;

export const ToolPolicyRule = z.object({
  mcp_id: z.string(),
  tool_name: z.string(),
  state: ToolPolicyState,
  reason: z.string().optional(),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
});
export type ToolPolicyRule = z.infer<typeof ToolPolicyRule>;

export const GovernancePolicy = z
  .object({
    version: z.literal(1).default(1),
    platform: z
      .object({
        always_deny: z.array(ToolPolicyRule).default([]),
        default_require_approval: z.array(ToolPolicyRule).default([]),
      })
      .default({ always_deny: [], default_require_approval: [] }),
    agents: z.record(z.string(), z.array(ToolPolicyRule)).default({}),
    updated_at: z.string().optional(),
  })
  .default({
    version: 1,
    platform: { always_deny: [], default_require_approval: [] },
    agents: {},
  });
export type GovernancePolicy = z.infer<typeof GovernancePolicy>;

export function emptyGovernancePolicy(): GovernancePolicy {
  return {
    version: 1,
    platform: { always_deny: [], default_require_approval: [] },
    agents: {},
  };
}

export function matchRule(
  rule: ToolPolicyRule,
  mcpId: string,
  toolName: string,
): boolean {
  const mcpMatch = rule.mcp_id === '*' || rule.mcp_id === mcpId;
  const toolMatch =
    rule.tool_name === '*' ||
    rule.tool_name === toolName ||
    (rule.tool_name.endsWith('*') &&
      toolName.startsWith(rule.tool_name.slice(0, -1)));
  return mcpMatch && toolMatch;
}

export interface PolicyEvaluation {
  state: ToolPolicyState;
  source: 'platform_deny' | 'agent_rule' | 'platform_require_approval' | 'default';
  rule?: ToolPolicyRule;
  reason?: string;
}

/**
 * Resolve a final state for (agent, mcp, tool). Precedence:
 *   1. platform.always_deny — hard kill-switch; nothing overrides this.
 *   2. agent rule (most specific match wins — exact beats prefix beats '*').
 *   3. platform.default_require_approval — applies when no agent rule says otherwise.
 *   4. default → 'inherit' (caller falls back to legacy allowed_tools/blocked_tools).
 */
export function evaluatePolicy(
  policy: GovernancePolicy,
  query: { agentId: string; mcpId: string; toolName: string },
): PolicyEvaluation {
  const { agentId, mcpId, toolName } = query;

  const platformDeny = bestMatch(policy.platform.always_deny, mcpId, toolName);
  if (platformDeny) {
    return {
      state: 'deny',
      source: 'platform_deny',
      rule: platformDeny,
      reason: platformDeny.reason ?? 'Denied by platform kill-switch',
    };
  }

  const agentRules = policy.agents[agentId] ?? [];
  const agentRule = bestMatch(agentRules, mcpId, toolName);
  if (agentRule && agentRule.state !== 'inherit') {
    return {
      state: agentRule.state,
      source: 'agent_rule',
      rule: agentRule,
      reason: agentRule.reason,
    };
  }

  const platformApproval = bestMatch(
    policy.platform.default_require_approval,
    mcpId,
    toolName,
  );
  if (platformApproval) {
    return {
      state: 'require_approval',
      source: 'platform_require_approval',
      rule: platformApproval,
      reason: platformApproval.reason ?? 'Platform default requires approval',
    };
  }

  return { state: 'inherit', source: 'default' };
}

export function setAgentRule(
  policy: GovernancePolicy,
  agentId: string,
  rule: ToolPolicyRule,
): GovernancePolicy {
  const agents = { ...policy.agents };
  const existing = agents[agentId] ?? [];
  const filtered = existing.filter(
    (r) => !(r.mcp_id === rule.mcp_id && r.tool_name === rule.tool_name),
  );
  agents[agentId] = [...filtered, rule];
  return {
    ...policy,
    agents,
    updated_at: rule.updated_at ?? new Date().toISOString(),
  };
}

export function removeAgentRule(
  policy: GovernancePolicy,
  agentId: string,
  mcpId: string,
  toolName: string,
): GovernancePolicy {
  const existing = policy.agents[agentId];
  if (!existing) return policy;
  const filtered = existing.filter(
    (r) => !(r.mcp_id === mcpId && r.tool_name === toolName),
  );
  const agents = filtered.length === 0
    ? omitKey(policy.agents, agentId)
    : { ...policy.agents, [agentId]: filtered };
  return { ...policy, agents, updated_at: new Date().toISOString() };
}

export function clearAgent(
  policy: GovernancePolicy,
  agentId: string,
): GovernancePolicy {
  if (!policy.agents[agentId]) return policy;
  const agents = omitKey(policy.agents, agentId);
  return { ...policy, agents, updated_at: new Date().toISOString() };
}

function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(obj)) {
    if (k !== key) out[k] = obj[k] as T;
  }
  return out;
}

export function setPlatformRule(
  policy: GovernancePolicy,
  bucket: 'always_deny' | 'default_require_approval',
  rule: ToolPolicyRule,
): GovernancePolicy {
  const existing = policy.platform[bucket];
  const filtered = existing.filter(
    (r) => !(r.mcp_id === rule.mcp_id && r.tool_name === rule.tool_name),
  );
  return {
    ...policy,
    platform: { ...policy.platform, [bucket]: [...filtered, rule] },
    updated_at: rule.updated_at ?? new Date().toISOString(),
  };
}

export function removePlatformRule(
  policy: GovernancePolicy,
  bucket: 'always_deny' | 'default_require_approval',
  mcpId: string,
  toolName: string,
): GovernancePolicy {
  const existing = policy.platform[bucket];
  const filtered = existing.filter(
    (r) => !(r.mcp_id === mcpId && r.tool_name === toolName),
  );
  if (filtered.length === existing.length) return policy;
  return {
    ...policy,
    platform: { ...policy.platform, [bucket]: filtered },
    updated_at: new Date().toISOString(),
  };
}

function bestMatch(
  rules: ToolPolicyRule[],
  mcpId: string,
  toolName: string,
): ToolPolicyRule | undefined {
  let best: { rule: ToolPolicyRule; score: number } | undefined;
  for (const rule of rules) {
    if (!matchRule(rule, mcpId, toolName)) continue;
    const score = specificity(rule);
    if (!best || score > best.score) best = { rule, score };
  }
  return best?.rule;
}

function specificity(rule: ToolPolicyRule): number {
  const mcpScore = rule.mcp_id === '*' ? 0 : 2;
  let toolScore: number;
  if (rule.tool_name === '*') toolScore = 0;
  else if (rule.tool_name.endsWith('*')) toolScore = 1;
  else toolScore = 3;
  return mcpScore + toolScore;
}

export interface ToolCatalogEntry {
  mcp_id: string;
  mcp_name: string;
  tool_name: string;
  description?: string;
  destructive?: boolean;
  agents: string[];
}

export interface ToolCatalogInput {
  agents: { id: string; mcp: string }[];
  mcps: {
    id: string;
    name: string;
    tools: { name: string; description?: string }[];
    destructiveTools?: string[];
  }[];
}

export function buildToolCatalog(input: ToolCatalogInput): ToolCatalogEntry[] {
  const agentsByMcp = new Map<string, string[]>();
  for (const a of input.agents) {
    const list = agentsByMcp.get(a.mcp) ?? [];
    list.push(a.id);
    agentsByMcp.set(a.mcp, list);
  }
  const out: ToolCatalogEntry[] = [];
  for (const mcp of input.mcps) {
    const destructive = new Set(mcp.destructiveTools ?? []);
    const users = agentsByMcp.get(mcp.id) ?? [];
    for (const tool of mcp.tools) {
      out.push({
        mcp_id: mcp.id,
        mcp_name: mcp.name,
        tool_name: tool.name,
        description: tool.description,
        destructive: destructive.has(tool.name),
        agents: users,
      });
    }
  }
  return out.sort((a, b) =>
    a.mcp_id === b.mcp_id
      ? a.tool_name.localeCompare(b.tool_name)
      : a.mcp_id.localeCompare(b.mcp_id),
  );
}
