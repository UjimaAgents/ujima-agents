import { z } from 'zod';

export const ToolPolicyState = z.enum([
  'allow',
  'deny',
  'require_approval',
  'require_input',
  'inherit',
]);
export type ToolPolicyState = z.infer<typeof ToolPolicyState>;

/**
 * Risk classification assigned per MCP tool. Drives the `risk_defaults`
 * fallback in the policy evaluator when no explicit rule matches.
 */
export const ToolRiskClass = z.enum(['read', 'write', 'destructive']);
export type ToolRiskClass = z.infer<typeof ToolRiskClass>;

/**
 * How a classification was assigned. `manual` survives re-test;
 * `inferred` and `registry` are recomputable.
 */
export const ToolClassificationSource = z.enum(['inferred', 'manual', 'registry']);
export type ToolClassificationSource = z.infer<typeof ToolClassificationSource>;

export const ToolPolicyRule = z.object({
  mcp_id: z.string(),
  tool_name: z.string(),
  state: ToolPolicyState,
  reason: z.string().optional(),
  updated_at: z.string().optional(),
  updated_by: z.string().optional(),
});
export type ToolPolicyRule = z.infer<typeof ToolPolicyRule>;

// Per-class fallback policy. `inherit` everywhere by default so adding
// risk_defaults to an existing policy is a no-op until an admin opts in.
export const RiskDefaultsSchema = z
  .object({
    read: ToolPolicyState.default('inherit'),
    write: ToolPolicyState.default('inherit'),
    destructive: ToolPolicyState.default('inherit'),
    unknown: ToolPolicyState.default('inherit'),
  })
  .default({});
export type RiskDefaults = z.infer<typeof RiskDefaultsSchema>;

export function emptyRiskDefaults(): RiskDefaults {
  return {
    read: 'inherit',
    write: 'inherit',
    destructive: 'inherit',
    unknown: 'inherit',
  };
}

export const GovernancePolicy = z
  .object({
    version: z.literal(1).default(1),
    platform: z
      .object({
        always_deny: z.array(ToolPolicyRule).default([]),
        // Org-wide allowlist. Tools matched here auto-run with no
        // approval prompt, overriding default_require_approval and
        // risk_defaults (but not always_deny or an explicit agent rule).
        // tool_name supports trailing-`*` wildcards via matchRule, so
        // one entry can cover e.g. `browser_*`.
        always_allow: z.array(ToolPolicyRule).default([]),
        default_require_approval: z.array(ToolPolicyRule).default([]),
      })
      .default({ always_deny: [], always_allow: [], default_require_approval: [] }),
    agents: z.record(z.string(), z.array(ToolPolicyRule)).default({}),
    risk_defaults: RiskDefaultsSchema,
    updated_at: z.string().optional(),
  })
  .default({
    version: 1,
    platform: { always_deny: [], always_allow: [], default_require_approval: [] },
    agents: {},
    risk_defaults: emptyRiskDefaults(),
  });
export type GovernancePolicy = z.infer<typeof GovernancePolicy>;

export function emptyGovernancePolicy(): GovernancePolicy {
  return {
    version: 1,
    platform: { always_deny: [], always_allow: [], default_require_approval: [] },
    agents: {},
    risk_defaults: emptyRiskDefaults(),
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
  source:
    | 'platform_deny'
    | 'agent_rule'
    | 'platform_allow'
    | 'platform_require_approval'
    | 'risk_default'
    | 'default';
  rule?: ToolPolicyRule;
  reason?: string;
  /** The classification the evaluator consulted, if any. */
  classification?: ToolRiskClass | 'unknown';
}

/**
 * Resolve a final state for (agent, mcp, tool). Precedence:
 *   1. platform.always_deny — hard kill-switch.
 *   2. agent rule (exact > prefix > '*').
 *   3. platform.always_allow vs platform.default_require_approval — the MORE
 *      SPECIFIC rule wins; on a specificity tie the safer require_approval
 *      wins, so a broad allowlist (e.g. `browser_*`) cannot silently override
 *      a narrowly-scoped approval gate (e.g. exact `browser_run_code`).
 *   4. risk_defaults[classification ?? 'unknown'].
 *   5. 'inherit' (caller falls back to legacy allowed_tools/blocked_tools).
 */
export function evaluatePolicy(
  policy: GovernancePolicy,
  query: {
    agentId: string;
    mcpId: string;
    toolName: string;
    classification?: ToolRiskClass | 'unknown';
  },
): PolicyEvaluation {
  const { agentId, mcpId, toolName, classification } = query;

  const platformDeny = bestMatch(policy.platform.always_deny, mcpId, toolName);
  if (platformDeny) {
    return {
      state: 'deny',
      source: 'platform_deny',
      rule: platformDeny,
      reason: platformDeny.reason ?? 'Denied by platform kill-switch',
      classification,
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
      classification,
    };
  }

  // always_allow and default_require_approval both live at platform scope and
  // can both match (e.g. a `browser_*` allowlist plus an exact
  // `browser_run_code` approval gate). Resolve by specificity rather than
  // bucket order: the more specific rule wins, and a tie resolves to
  // require_approval so a coarse allow never defeats a deliberate fine-grained
  // gate. always_deny (above) remains an absolute kill-switch.
  const platformAllow = bestMatch(policy.platform.always_allow, mcpId, toolName);
  const platformApproval = bestMatch(
    policy.platform.default_require_approval,
    mcpId,
    toolName,
  );
  if (platformAllow || platformApproval) {
    const allowScore = platformAllow ? specificity(platformAllow) : -1;
    const approvalScore = platformApproval ? specificity(platformApproval) : -1;
    if (platformApproval && approvalScore >= allowScore) {
      return {
        state: 'require_approval',
        source: 'platform_require_approval',
        rule: platformApproval,
        reason: platformApproval.reason ?? 'Platform default requires approval',
        classification,
      };
    }
    // platformAllow is defined here: either platformApproval is undefined, or
    // allowScore > approvalScore (so platformAllow matched and is more specific).
    return {
      state: 'allow',
      source: 'platform_allow',
      rule: platformAllow as ToolPolicyRule,
      reason: (platformAllow as ToolPolicyRule).reason ?? 'Allowed by org-wide allowlist',
      classification,
    };
  }

  // risk_defaults only applies to *MCP* tools whose classification was
  // looked up. Built-in tools (channel.*, self.*, supervisor.*, view,
  // ls, glob, …) never have a classification — they have their own
  // policy enforcement in the orchestrator (`checkToolPolicy`). If we
  // treated `classification === undefined` as the `unknown` bucket,
  // setting `risk_defaults.unknown = 'require_approval'` would block
  // EVERY built-in messaging / read tool, breaking standups and
  // mandatory-reply turns. Require an explicit `'unknown'` from the
  // classificationLookup before applying the unknown bucket.
  if (classification !== undefined) {
    const bucket: keyof RiskDefaults = classification;
    const riskState = policy.risk_defaults?.[bucket] ?? 'inherit';
    if (riskState !== 'inherit') {
      return {
        state: riskState,
        source: 'risk_default',
        reason: `Org default for ${bucket} tools is ${riskState}`,
        classification,
      };
    }
  }

  return { state: 'inherit', source: 'default', classification };
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
  bucket: 'always_deny' | 'always_allow' | 'default_require_approval',
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

export function setRiskDefaults(
  policy: GovernancePolicy,
  next: Partial<RiskDefaults>,
): GovernancePolicy {
  const merged: RiskDefaults = {
    read: next.read ?? policy.risk_defaults.read,
    write: next.write ?? policy.risk_defaults.write,
    destructive: next.destructive ?? policy.risk_defaults.destructive,
    unknown: next.unknown ?? policy.risk_defaults.unknown,
  };
  return {
    ...policy,
    risk_defaults: merged,
    updated_at: new Date().toISOString(),
  };
}

export function removePlatformRule(
  policy: GovernancePolicy,
  bucket: 'always_deny' | 'always_allow' | 'default_require_approval',
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
