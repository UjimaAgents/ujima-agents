import type { AgentTeamHandle } from '@ujima/framework';
import type { z } from 'zod';
import type { ConversationService } from '../services/conversation.js';
import type { GoalSystemService } from '../services/goal-system.js';
import type { ApiRepository, RepositoryReader } from '../services/repository-reader.js';
import type { DelegateKind } from '../utils/delegate-turn.js';
import type { ToolInvocationInput } from '../services/tool-service.js';
import type {
  AdvanceInput,
  AdvanceResult,
  StartRunInput,
  TransitionInput,
  TransitionResult,
} from '../services/workflow-engine.js';

/** The slice of the workflow engine the `workflow.*` tools call. */
export interface WorkflowEngineToolAccess {
  startRun(input: StartRunInput): Promise<{ workflowRunId: string }>;
  transition(input: TransitionInput): Promise<TransitionResult>;
  /** `workflow.advance` — the engine is the single writer of node-run state. */
  advance(input: AdvanceInput): Promise<AdvanceResult>;
}

export interface AgentDelegateResult {
  status:
    | 'completed'
    | 'no_reply'
    | 'timed_out'
    | 'delegate_failed'
    | 'dispatched'
    | 'waiting_for_approval'
    | 'waiting_for_input';
  agent: string;
  agent_id: string;
  thread_id: string;
  message_id: string;
  delegate_index?: number;
  reply_id?: string;
  reply_content?: string;
  run_status?: string;
  error?: string;
}

export interface DelegateThreadMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface DelegateHandlers {
  delegateAgentTurn: (input: {
    organizationId: string;
    fromMemberId: string;
    to?: string;
    name?: string;
    message: string;
    kind?: DelegateKind;
    index?: number;
    runId: string;
    mode?: 'blocking' | 'non_blocking';
    timeoutMs?: number;
    pollIntervalMs?: number;
  }) => Promise<AgentDelegateResult>;
  getDelegateStatus: (organizationId: string, delegateId: string) => Promise<AgentDelegateResult>;
  waitForDelegates: (
    organizationId: string,
    delegateIds: string[],
    timeoutMs?: number,
    pollIntervalMs?: number,
  ) => Promise<AgentDelegateResult[]>;
  stopDelegate: (
    organizationId: string,
    delegateId: string,
  ) => Promise<{ stopped: boolean; runId?: string }>;
  readDelegateThread: (
    organizationId: string,
    delegateId: string,
    limit?: number,
  ) => Promise<DelegateThreadMessage[]>;
  sendToDelegate: (
    organizationId: string,
    delegateId: string,
    message: string,
    fromMemberId: string,
  ) => Promise<{ sent: boolean; messageId: string }>;
}

export interface ToolExecutionContext {
  invocation: ToolInvocationInput;
  team: AgentTeamHandle;
  repo: ApiRepository;
  conversations: ConversationService;
  goals: GoalSystemService;
  delegateAgentTurn: DelegateHandlers['delegateAgentTurn'];
  getDelegateStatus: DelegateHandlers['getDelegateStatus'];
  waitForDelegates: DelegateHandlers['waitForDelegates'];
  stopDelegate: DelegateHandlers['stopDelegate'];
  readDelegateThread: DelegateHandlers['readDelegateThread'];
  sendToDelegate: DelegateHandlers['sendToDelegate'];
  /**
   * Present when workflows are wired at the composition root. `workflow.run`,
   * `workflow.transition`, and `workflow.advance` require it (the engine is
   * the single writer of run state); `workflow.list`/`view` operate on `repo`
   * alone and work without it.
   */
  workflowEngine?: WorkflowEngineToolAccess;
  reportProgress?: (output: unknown) => Promise<void> | void;
  /**
   * Root for agent-generated attachments. Absent → channel-tool
   * `attachments` params return a structured error.
   */
  agentAttachmentRoot?: string;
  /**
   * `<home>/attachments/` — canonical store root. Used by rollback
   * paths to construct the absolute path of an agent-attachment
   * file by joining against the row's storage_path column.
   */
  attachmentStoreRoot?: string;
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
  /**
   * Whether this invocation is happening inside a channel or a 1:1 DM
   * thread. Lets schema factories constrain affordances by surface —
   * e.g. `channel.dm` drops the agent roster (allowing only `self`)
   * when the run originates in a channel, so agents collaborate
   * in-channel via `@`-mentions instead of siloing into private DMs.
   */
  conversationKind: 'dm' | 'channel';
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
