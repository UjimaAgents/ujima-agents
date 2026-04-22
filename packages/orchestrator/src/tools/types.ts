import { z } from 'zod';
import type { ToolInvocationInput } from '../services/tool-service.js';
import type { AgentTeamHandle } from '@ujima/framework';
import type { ApiRepository } from '../services/repository-reader.js';
import type { ConversationService } from '../services/conversation.js';

export interface ToolExecutionContext {
  invocation: ToolInvocationInput;
  team: AgentTeamHandle;
  repo: ApiRepository;
  conversations: ConversationService;
}

export interface OrchestratorTool<TArgs extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string;
  schema: TArgs;
  toInvocation: (args: z.infer<TArgs>) => Pick<ToolInvocationInput, 'action' | 'resourceType' | 'resourcePath' | 'input'>;
  execute: (context: ToolExecutionContext) => Promise<unknown> | unknown;
}
