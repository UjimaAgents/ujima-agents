import { z } from 'zod';
import { AgentPermissions, AuditRecord, ExecutionMode, OrchestratorMode, ApprovalMode } from './types';
import { GovernancePolicy, ToolPolicyRule } from './governance-policy';

const ToolCatalogEntryShape = z.object({
  mcp_id: z.string(),
  mcp_name: z.string(),
  tool_name: z.string(),
  description: z.string().optional(),
  destructive: z.boolean().optional(),
  agents: z.array(z.string()),
});

const PlatformBucket = z.enum(['always_deny', 'default_require_approval']);

const AuditRecordShape = AuditRecord;

const RateSampleShape = z.object({
  at: z.string(),
  calls: z.number().nonnegative(),
  tokens: z.number().nonnegative(),
});

const SessionSummaryShape = z.object({
  session_id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  status: z.enum(['running', 'ended', 'killed']),
  agent_ids: z.array(z.string()),
  task_ids: z.array(z.string()),
  tool_calls: z.number().nonnegative(),
  blocked_calls: z.number().nonnegative(),
});

const PendingGateShape = z.object({
  id: z.string(),
  agent_id: z.string(),
  agent_name: z.string().optional(),
  task_id: z.string(),
  session_id: z.string(),
  tool_call_id: z.string(),
  tool_name: z.string(),
  mcp_id: z.string(),
  mcp_name: z.string().optional(),
  args: z.record(z.string(), z.unknown()),
  gate: z.enum(['approval', 'input']),
  code: z.enum(['requires_approval', 'requires_input']),
  reason: z.string().optional(),
  requested_at: z.string(),
});

const GovernanceAgent = z.object({
  id: z.string(),
  name: z.string(),
  mcp: z.string(),
  status: z.enum(['idle', 'active', 'waiting', 'blocked', 'killed', 'exited']),
  lastAction: z.string().optional(),
  tokensUsed: z.number().int().nonnegative().default(0),
  tokenCap: z.number().int().nonnegative().default(0),
  permissions: AgentPermissions.optional(),
});

export const HostToWebviewMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), payload: z.object({ version: z.string() }) }),
  z.object({
    type: z.literal('agents.updated'),
    payload: z.object({
      agents: z.array(GovernanceAgent),
    }),
  }),
  z.object({
    type: z.literal('governance.snapshot'),
    payload: z.object({
      session_id: z.string(),
      agents: z.array(GovernanceAgent),
      audit: z.array(AuditRecordShape),
      rate: z.array(z.object({ agentId: z.string(), samples: z.array(RateSampleShape) })),
      sessions: z.array(SessionSummaryShape),
      approval_mode: ApprovalMode.optional(),
    }),
  }),
  z.object({
    type: z.literal('audit.appended'),
    payload: z.object({ records: z.array(AuditRecordShape) }),
  }),
  z.object({
    type: z.literal('rate.updated'),
    payload: z.object({
      agentId: z.string(),
      samples: z.array(RateSampleShape),
    }),
  }),
  z.object({
    type: z.literal('sessions.updated'),
    payload: z.object({ sessions: z.array(SessionSummaryShape) }),
  }),
  z.object({
    type: z.literal('audit.export.ready'),
    payload: z.object({ format: z.enum(['json', 'csv']), path: z.string() }),
  }),
  z.object({
    type: z.literal('events.appended'),
    payload: z.object({
      events: z.array(
        z.object({
          event_id: z.string(),
          type: z.string(),
          publisher: z.string(),
          timestamp: z.string(),
          task_id: z.string().optional(),
          session_id: z.string().optional(),
          payload: z.unknown(),
        }),
      ),
    }),
  }),
  z.object({
    type: z.literal('approval.requested'),
    payload: z.object({
      approval_id: z.string(),
      task_id: z.string(),
      artifact_key: z.string(),
      domain: z.string(),
      proposed_by: z.string(),
      summary: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('task.completed'),
    payload: z.object({
      task_id: z.string(),
      summary: z.string(),
    }),
  }),
  z.object({
    type: z.literal('governance.policy.snapshot'),
    payload: z.object({
      policy: GovernancePolicy,
      catalog: z.array(ToolCatalogEntryShape),
    }),
  }),
  z.object({
    type: z.literal('governance.gates.snapshot'),
    payload: z.object({
      pending: z.array(PendingGateShape),
    }),
  }),
  z.object({
    type: z.literal('governance.gates.added'),
    payload: z.object({ gate: PendingGateShape }),
  }),
  z.object({
    type: z.literal('governance.gates.resolved'),
    payload: z.object({
      id: z.string(),
      outcome: z.enum(['approve', 'reject', 'expired', 'aborted']),
      decided_by: z.string().optional(),
      reason: z.string().optional(),
    }),
  }),
]);
export type HostToWebviewMessage = z.infer<typeof HostToWebviewMessage>;
export type PendingGate = z.infer<typeof PendingGateShape>;

export const WebviewToHostMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({
    type: z.literal('task.submit'),
    payload: z.object({
      prompt: z.string().min(1),
      orchestrator_mode: OrchestratorMode.default('manual'),
      execution_mode: ExecutionMode.default('concurrent'),
      team_id: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('approval.decide'),
    payload: z.object({
      approval_id: z.string(),
      decision: z.enum(['approved', 'rejected']),
      reason: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('agent.kill'),
    payload: z.object({ agent_id: z.string() }),
  }),
  z.object({ type: z.literal('session.kill') }),
  z.object({
    type: z.literal('approvals.setMode'),
    payload: z.object({ mode: ApprovalMode }),
  }),
  z.object({
    type: z.literal('governance.agent.updatePermissions'),
    payload: z.object({
      agent_id: z.string(),
      permissions: AgentPermissions,
      scope: z.enum(['session', 'def']),
    }),
  }),
  z.object({
    type: z.literal('governance.audit.export'),
    payload: z.object({ format: z.enum(['json', 'csv']) }),
  }),
  z.object({
    type: z.literal('governance.session.load'),
    payload: z.object({ session_id: z.string() }),
  }),
  z.object({
    type: z.literal('governance.policy.update'),
    payload: z.discriminatedUnion('op', [
      z.object({
        op: z.literal('setAgent'),
        agent_id: z.string(),
        rule: ToolPolicyRule,
      }),
      z.object({
        op: z.literal('removeAgent'),
        agent_id: z.string(),
        mcp_id: z.string(),
        tool_name: z.string(),
      }),
      z.object({ op: z.literal('clearAgent'), agent_id: z.string() }),
      z.object({
        op: z.literal('setPlatform'),
        bucket: PlatformBucket,
        rule: ToolPolicyRule,
      }),
      z.object({
        op: z.literal('removePlatform'),
        bucket: PlatformBucket,
        mcp_id: z.string(),
        tool_name: z.string(),
      }),
      z.object({ op: z.literal('quickRevoke'), agent_id: z.string() }),
    ]),
  }),
  z.object({ type: z.literal('governance.policy.refresh') }),
  z.object({
    type: z.literal('governance.gate.decide'),
    payload: z.discriminatedUnion('outcome', [
      z.object({
        id: z.string(),
        outcome: z.literal('approve'),
        args: z.record(z.string(), z.unknown()).optional(),
        reason: z.string().optional(),
      }),
      z.object({
        id: z.string(),
        outcome: z.literal('reject'),
        reason: z.string().optional(),
      }),
    ]),
  }),
]);
export type WebviewToHostMessage = z.infer<typeof WebviewToHostMessage>;
