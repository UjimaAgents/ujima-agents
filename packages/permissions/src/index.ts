import type {
  AgentDef,
  MCPDef,
  GovernancePolicy,
  ToolPolicyRule,
  ToolRiskClass,
} from '@ujima/shared';
import { evaluatePolicy } from '@ujima/shared';
import type { AuditLog, AgentStateStore } from '@ujima/context-store';

export type PermissionDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: string;
      code: PermissionDenyCode;
      gate?: PermissionGate;
      rule?: ToolPolicyRule;
    };

export type PermissionDenyCode =
  | 'blocked_tool'
  | 'not_allowed_tool'
  | 'destructive_pattern'
  | 'token_cap_exceeded'
  | 'session_override'
  | 'policy_deny'
  | 'requires_approval'
  | 'requires_input';

export type PermissionGate = 'approval' | 'input';

export interface PermissionCheckInput {
  agent: AgentDef;
  mcp: Pick<MCPDef, 'id'> & Partial<Pick<MCPDef, 'name'>>;
  toolName: string;
  args: unknown;
  taskId: string;
  sessionId: string;
}

export interface PlatformDefaults {
  blocked_tools: string[];
  destructive_patterns: (string | RegExp)[];
}

export interface MCPPolicy {
  allowed_tools?: string[];
  blocked_tools?: string[];
}

export interface SessionOverride {
  blocked_tools?: string[];
  allowed_tools?: string[];
  paused?: boolean;
}

export type ClassificationLookup = (
  mcpId: string,
  toolName: string,
) => ToolRiskClass | 'unknown' | undefined;

export interface PermissionMiddlewareDeps {
  audit?: AuditLog;
  agentState?: AgentStateStore;
  platformDefaults?: PlatformDefaults;
  mcpPolicies?: Record<string, MCPPolicy>;
  sessionOverrides?: Record<string, SessionOverride>;
  governancePolicy?: GovernancePolicy | ((taskId?: string) => GovernancePolicy | undefined);
  classificationLookup?: ClassificationLookup;
  now?: () => number;
}

export interface PermissionMiddleware {
  check(input: PermissionCheckInput): Promise<PermissionDecision>;
  recordCompletedCall(input: PermissionCheckInput): Promise<void>;
  recordUsage(agentId: string, tokens: number): Promise<void>;
  setSessionOverride(agentId: string, override: SessionOverride): void;
  clearSessionOverride(agentId: string): void;
  setGovernancePolicy(policy: GovernancePolicy | undefined): void;
  getGovernancePolicy(): GovernancePolicy | undefined;
}

const DEFAULT_PLATFORM_DEFAULTS: PlatformDefaults = {
  blocked_tools: [],
  destructive_patterns: [
    /\brm\s+-rf\s+\//i,
    /\bDROP\s+(DATABASE|TABLE|SCHEMA)\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /git\s+push\s+--force/i,
    /:\(\)\s*\{\s*:\|:&\s*\}/,
  ],
};

export function createPermissionMiddleware(
  deps: PermissionMiddlewareDeps = {},
): PermissionMiddleware {
  const platformDefaults = deps.platformDefaults ?? DEFAULT_PLATFORM_DEFAULTS;
  const mcpPolicies = deps.mcpPolicies ?? {};
  const sessionOverrides = new Map<string, SessionOverride>(
    Object.entries(deps.sessionOverrides ?? {}),
  );
  const now = deps.now ?? (() => Date.now());

  let governancePolicy: GovernancePolicy | undefined;
  let governancePolicyFn: ((taskId?: string) => GovernancePolicy | undefined) | undefined;
  if (typeof deps.governancePolicy === 'function') {
    governancePolicyFn = deps.governancePolicy;
  } else {
    governancePolicy = deps.governancePolicy;
  }
  const resolveGovernancePolicy = (taskId?: string): GovernancePolicy | undefined =>
    governancePolicyFn ? governancePolicyFn(taskId) : governancePolicy;

  async function writeAudit(
    input: PermissionCheckInput,
    decision: PermissionDecision,
  ): Promise<void> {
    if (!deps.audit) return;
    await deps.audit.write({
      event_id: `perm_${now()}_${Math.random().toString(36).slice(2, 8)}`,
      event_type: 'permission_check',
      agent_id: input.agent.id,
      task_id: input.taskId,
      session_id: input.sessionId,
      tool_name: input.toolName,
      tool_input: input.args,
      allowed: decision.allowed,
      block_reason: decision.allowed
        ? undefined
        : `${decision.code}: ${decision.reason}`,
    });
  }

  function matchesDestructivePattern(args: unknown): boolean {
    const serialized = typeof args === 'string' ? args : JSON.stringify(args ?? '');
    for (const pattern of platformDefaults.destructive_patterns) {
      if (typeof pattern === 'string') {
        if (serialized.includes(pattern)) return true;
      } else if (pattern.test(serialized)) {
        return true;
      }
    }
    return false;
  }

  async function checkTokenCap(
    agentId: string,
    cap: number,
  ): Promise<boolean> {
    if (!deps.agentState) return true;
    const state = await deps.agentState.get(agentId);
    if (!state) return true;
    return state.tokens_used < cap;
  }

  return {
    async check(input) {
      const { agent, mcp, toolName } = input;

      const override = sessionOverrides.get(agent.id);
      if (override?.paused) {
        const decision: PermissionDecision = {
          allowed: false,
          reason: `Agent "${agent.id}" is paused by session override`,
          code: 'session_override',
        };
        await writeAudit(input, decision);
        return decision;
      }
      if (override?.blocked_tools?.includes(toolName)) {
        const decision: PermissionDecision = {
          allowed: false,
          reason: `Tool "${toolName}" blocked by session override`,
          code: 'session_override',
        };
        await writeAudit(input, decision);
        return decision;
      }

      const policy = resolveGovernancePolicy(input.taskId);
      let policyAllowOverride = false;
      if (policy) {
        const classification = deps.classificationLookup?.(mcp.id, toolName);
        const evaluation = evaluatePolicy(policy, {
          agentId: agent.id,
          mcpId: mcp.id,
          toolName,
          classification,
        });
        if (evaluation.state === 'deny') {
          const decision: PermissionDecision = {
            allowed: false,
            reason:
              evaluation.reason ??
              `Tool "${toolName}" denied by governance policy (${evaluation.source})`,
            code: evaluation.source === 'platform_deny' ? 'blocked_tool' : 'policy_deny',
            rule: evaluation.rule,
          };
          await writeAudit(input, decision);
          return decision;
        }
        if (evaluation.state === 'require_approval') {
          const decision: PermissionDecision = {
            allowed: false,
            reason:
              evaluation.reason ??
              `Tool "${toolName}" requires human approval before running`,
            code: 'requires_approval',
            gate: 'approval',
            rule: evaluation.rule,
          };
          await writeAudit(input, decision);
          return decision;
        }
        if (evaluation.state === 'require_input') {
          const decision: PermissionDecision = {
            allowed: false,
            reason:
              evaluation.reason ??
              `Tool "${toolName}" requires the user to confirm/edit arguments before running`,
            code: 'requires_input',
            gate: 'input',
            rule: evaluation.rule,
          };
          await writeAudit(input, decision);
          return decision;
        }
        // `allow` is an explicit admin override: it bypasses the legacy
        // blocked_tools / allowed_tools / mcpPolicies layers below. Safety
        // rails (destructive_patterns, token cap) still apply.
        if (evaluation.state === 'allow') {
          policyAllowOverride = true;
        }
        // `inherit` → keep going through the legacy checks as before.
      }

      if (!policyAllowOverride && platformDefaults.blocked_tools.includes(toolName)) {
        const decision: PermissionDecision = {
          allowed: false,
          reason: `Tool "${toolName}" is blocked by platform defaults`,
          code: 'blocked_tool',
        };
        await writeAudit(input, decision);
        return decision;
      }

      if (matchesDestructivePattern(input.args)) {
        const decision: PermissionDecision = {
          allowed: false,
          reason: `Input matches a destructive pattern and requires explicit approval`,
          code: 'destructive_pattern',
          gate: 'approval',
        };
        await writeAudit(input, decision);
        return decision;
      }

      if (!policyAllowOverride) {
        const mcpPolicy = mcpPolicies[mcp.id];
        if (mcpPolicy?.blocked_tools?.includes(toolName)) {
          const decision: PermissionDecision = {
            allowed: false,
            reason: `Tool "${toolName}" is blocked by MCP policy for "${mcp.id}"`,
            code: 'blocked_tool',
          };
          await writeAudit(input, decision);
          return decision;
        }
        if (
          mcpPolicy?.allowed_tools &&
          mcpPolicy.allowed_tools.length > 0 &&
          !mcpPolicy.allowed_tools.includes(toolName)
        ) {
          const decision: PermissionDecision = {
            allowed: false,
            reason: `Tool "${toolName}" is not in MCP allowed_tools for "${mcp.id}"`,
            code: 'not_allowed_tool',
          };
          await writeAudit(input, decision);
          return decision;
        }

        if (agent.permissions.blocked_tools.includes(toolName)) {
          const decision: PermissionDecision = {
            allowed: false,
            reason: `Tool "${toolName}" is blocked for agent "${agent.id}"`,
            code: 'blocked_tool',
          };
          await writeAudit(input, decision);
          return decision;
        }
        if (
          agent.permissions.allowed_tools.length > 0 &&
          !agent.permissions.allowed_tools.includes(toolName)
        ) {
          const decision: PermissionDecision = {
            allowed: false,
            reason: `Tool "${toolName}" is not in agent allowed_tools for "${agent.id}"`,
            code: 'not_allowed_tool',
          };
          await writeAudit(input, decision);
          return decision;
        }
      }

      if (!(await checkTokenCap(agent.id, agent.permissions.rate_limit.max_session_tokens))) {
        const decision: PermissionDecision = {
          allowed: false,
          reason: `Agent "${agent.id}" hit token cap of ${agent.permissions.rate_limit.max_session_tokens}`,
          code: 'token_cap_exceeded',
        };
        await writeAudit(input, decision);
        return decision;
      }

      const allow: PermissionDecision = { allowed: true };
      await writeAudit(input, allow);
      return allow;
    },

    async recordCompletedCall(input) {
      if (deps.agentState) {
        await deps.agentState.incrementCalls(input.agent.id);
      }
    },

    async recordUsage(agentId, tokens) {
      if (deps.agentState) {
        await deps.agentState.incrementTokens(agentId, tokens);
      }
    },

    setSessionOverride(agentId, override) {
      sessionOverrides.set(agentId, override);
    },

    clearSessionOverride(agentId) {
      sessionOverrides.delete(agentId);
    },

    setGovernancePolicy(policy) {
      governancePolicy = policy;
      governancePolicyFn = undefined;
    },

    getGovernancePolicy() {
      return resolveGovernancePolicy();
    },
  };
}

export function checkPermission(input: {
  agent: AgentDef;
  mcpId: string;
  toolName: string;
  args: unknown;
}): PermissionDecision {
  const { agent, toolName } = input;
  if (agent.permissions.blocked_tools.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is blocked for agent "${agent.id}"`,
      code: 'blocked_tool',
    };
  }
  if (
    agent.permissions.allowed_tools.length > 0 &&
    !agent.permissions.allowed_tools.includes(toolName)
  ) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not in allowed_tools for agent "${agent.id}"`,
      code: 'not_allowed_tool',
    };
  }
  return { allowed: true };
}

export * from './workspace-policy.js';
