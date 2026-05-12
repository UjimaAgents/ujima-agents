import type { AgentTeamHandle } from '@ujima/framework';
import type { z } from 'zod';
import type { ConversationService } from '../services/conversation.js';
import type { ApiRepository } from '../services/repository-reader.js';
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

export interface OrchestratorTool<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  schema: z.ZodTypeAny;
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
