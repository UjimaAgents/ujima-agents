import { z } from 'zod';
import type { OrchestratorTool, ToolExecutionContext } from './types.js';

const AgentDelegateSchema = z.object({
  to: z.string().min(1).describe('Agent name or id to delegate to'),
  message: z.string().min(1).describe('Message to send to the agent'),
});

type AgentDelegateArgs = z.infer<typeof AgentDelegateSchema>;

async function delegateAgent(ctx: ToolExecutionContext, args: AgentDelegateArgs) {
  return ctx.delegateAgentTurn({
    organizationId: ctx.invocation.organizationId,
    fromMemberId: ctx.invocation.memberId,
    to: args.to,
    message: args.message,
    runId: ctx.invocation.runId,
  });
}

export const agentDelegateTool: OrchestratorTool<typeof AgentDelegateSchema> = {
  id: 'agent.delegate',
  schema: AgentDelegateSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'mcp',
    input: args as unknown as Record<string, unknown>,
  }),
  execute: (ctx) => delegateAgent(ctx, ctx.invocation.input as unknown as AgentDelegateArgs),
};
