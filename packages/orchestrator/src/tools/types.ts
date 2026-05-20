import type { AgentTeamHandle } from '@ujima/framework';
import type { z } from 'zod';
import type { ConversationService } from '../services/conversation.js';
import type { ApiRepository, RepositoryReader } from '../services/repository-reader.js';
import type { SupervisorTodoService } from '../services/supervisor-todo.js';
import type { ToolInvocationInput } from '../services/tool-service.js';

export interface ToolExecutionContext {
  invocation: ToolInvocationInput;
  team: AgentTeamHandle;
  repo: ApiRepository;
  conversations: ConversationService;
  reportProgress?: (output: unknown) => Promise<void> | void;
  /**
   * Phase 2.B — supervisor.todo.* tools route through this service.
   * Optional so tests / pre-Phase-2 contexts that don't construct
   * a SupervisorTodoService still work.
   */
  supervisorTodos?: SupervisorTodoService;
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
