import { z } from 'zod';

export const Seniority = z.enum(['senior', 'junior']);
export type Seniority = z.infer<typeof Seniority>;

export const AgentPermissions = z.object({
  allowed_tools: z.array(z.string()).default([]),
  blocked_tools: z.array(z.string()).default([]),
  rate_limit: z
    .object({
      max_session_tokens: z.number().int().positive().default(100_000),
    })
    .default({ max_session_tokens: 100_000 }),
});
export type AgentPermissions = z.infer<typeof AgentPermissions>;

export const AgentDef = z.object({
  id: z.string(),
  name: z.string(),
  persona: z.string(),
  model: z.string(),
  mcp: z.string(),
  workspace_scopes: z.array(z.string()).optional(),
  permissions: AgentPermissions,
  communication: z
    .object({
      publishes: z.array(z.string()).default([]),
      subscribes: z.array(z.string()).default([]),
    })
    .default({ publishes: [], subscribes: [] }),
  escalation: z
    .object({
      conditions: z.array(z.string()).default([]),
      escalate_to: z.string().default('human'),
    })
    .default({ conditions: [], escalate_to: 'human' }),
  seniority: Seniority.optional(),
  reports_to: z.string().optional(),
  reviews: z.array(z.string()).optional(),
});
export type AgentDef = z.infer<typeof AgentDef>;

export const MCPTransport = z.enum(['stdio', 'sse', 'http-streamable']);
export type MCPTransport = z.infer<typeof MCPTransport>;

export const MCPIsolation = z.enum(['shared', 'per-agent']);
export type MCPIsolation = z.infer<typeof MCPIsolation>;

export const MCPDef = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default('0.0.0'),
  description: z.string().default(''),
  category: z.string().default('general'),
  transport: MCPTransport.default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  headers: z.record(z.string()).optional(),
  url: z.string().optional(),
  /**
   * `shared` (default): one MCP process per `id`, reused across agents.
   * `per-agent`: pool spawns a dedicated process per (id, agentId). Use for
   * stateful MCPs where two agents sharing the same session would step on
   * each other's state — browsers (Playwright), desktop automation, long-
   * running REPLs.
   */
  isolation: MCPIsolation.default('shared'),
});
export type MCPDef = z.infer<typeof MCPDef>;

export const ExecutionMode = z.enum(['concurrent', 'slim']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

export const OrchestratorMode = z.enum(['manual', 'auto']);
export type OrchestratorMode = z.infer<typeof OrchestratorMode>;

export const ApprovalMode = z.enum(['human_all', 'senior_auto', 'hybrid']);
export type ApprovalMode = z.infer<typeof ApprovalMode>;

export const TeamDef = z.object({
  team_id: z.string(),
  name: z.string(),
  agents: z.array(z.string()),
  orchestrator: z
    .object({
      model: z.string(),
      max_task_duration_hours: z.number().positive().default(4),
      human_review_required_before: z.array(z.string()).default([]),
    })
    .optional(),
});
export type TeamDef = z.infer<typeof TeamDef>;

export const TaskDef = z.object({
  task_id: z.string(),
  prompt: z.string(),
  team_id: z.string().optional(),
  orchestrator_mode: OrchestratorMode.default('manual'),
  execution_mode: ExecutionMode.default('concurrent'),
});
export type TaskDef = z.infer<typeof TaskDef>;

export interface UjimaEvent<T = unknown> {
  event_id: string;
  type: string;
  publisher: string;
  timestamp: string;
  payload: T;
  task_id?: string;
  session_id?: string;
}

export const AuditRecord = z.object({
  event_id: z.string(),
  event_type: z.enum([
    'tool_call',
    'permission_check',
    'event_published',
    'escalation',
    'spawn',
    'exit',
    'kill',
  ]),
  agent_id: z.string(),
  task_id: z.string(),
  session_id: z.string(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_output: z.unknown().optional(),
  allowed: z.boolean(),
  block_reason: z.string().optional(),
  tokens_used: z.number().optional(),
  duration_ms: z.number().optional(),
  created_at: z.string(),
});
export type AuditRecord = z.infer<typeof AuditRecord>;
