import { z } from 'zod';
import { mcpPermissionToolName } from '../services/mcp-runtime.js';
import type { OrchestratorTool } from './types.js';

const McpToolSchema = z.object({
  mcpServerId: z.string().min(1).describe('Approved MCP server id'),
  toolName: z.string().min(1).describe('Tool name on that server'),
  args: z.record(z.string(), z.unknown()).default({}).describe('Arguments for the MCP tool'),
});

type McpToolArgs = z.infer<typeof McpToolSchema>;

export const mcpTool: OrchestratorTool<typeof McpToolSchema> = {
  id: 'mcp',
  schema: McpToolSchema,
  toInvocation: (args: McpToolArgs) => ({
    action: 'mcp',
    resourceType: 'mcp',
    resourcePath: `${args.mcpServerId}:${args.toolName}`,
    permissionMcpId: args.mcpServerId,
    permissionToolName: mcpPermissionToolName(args.mcpServerId, args.toolName),
    input: {
      mcpServerId: args.mcpServerId,
      toolName: args.toolName,
      args: args.args,
    },
  }),
  execute: () => {
    throw new Error('MCP tool execution is handled by ToolService');
  },
};
