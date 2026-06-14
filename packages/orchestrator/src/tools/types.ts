import type { AgentTeamHandle } from '@ujima/framework';
import type { z } from 'zod';
import type { ConversationService } from '../services/conversation.js';
import type { GoalSystemService } from '../services/goal-system.js';
import type { ApiRepository, RepositoryReader } from '../services/repository-reader.js';
import type { ToolInvocationInput } from '../services/tool-service.js';

export interface AgentDelegateResult {
  status: 'completed' | 'no_reply' | 'timed_out' | 'delegate_failed';
  agent: string;
  agent_id: string;
  thread_id: string;
  message_id: string;
  reply_id?: string;
  reply_content?: string;
  run_status?: string;
  error?: string;
}

export interface ToolExecutionContext {
  invocation: ToolInvocationInput;
  team: AgentTeamHandle;
  repo: ApiRepository;
  conversations: ConversationService;
  goals: GoalSystemService;
  delegateAgentTurn: (input: {
    organizationId: string;
    fromMemberId: string;
    to: string;
    message: string;
    runId: string;
  }) => Promise<AgentDelegateResult>;
  reportProgress?: (output: unknown) => Promise<void> | void;
  /**
   * Root for agent-generated attachments. Absent → channel-tool
   * `attachments` params return a structured error.
   */
  agentAttachmentRoot?: string;
}

/**
 * Per-invocation context passed to {@link OrchestratorTool.buildSchema}
 * when a tool needs to derive its input schema from real-world state
 * (e.g. `channel.handoff` building a `to:` enum from the org roster).
 */
export interface BuildSchemaContext {
  organizationId: string;
  memberId: string;
  repo: RepositoryReader;
}

export interface OrchestratorTool<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  schema: z.ZodTypeAny;
  /**
   * Optional per-invocation schema factory. When present, replaces the
   * static `schema` for this specific invocation. Used by
   * `channel.handoff` to constrain `to:` to the actual roster of valid
   * agent recipients — kills phantom-recipient hallucinations at the
   * decode layer, not after the fact.
   */
  buildSchema?(ctx: BuildSchemaContext): z.ZodTypeAny;
  toInvocation: (args: z.infer<TArgs>) => Pick<
    ToolInvocationInput,
    | 'action'
    | 'resourceType'
    | 'resourcePath'
    | 'input'
    | 'permissionMcpId'
    | 'permissionToolName'
    | 'bypassPermission'
  >;
  execute: (context: ToolExecutionContext) => Promise<unknown> | unknown;
}
