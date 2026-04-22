import type {
  MCPConnection,
  ToolCallContext,
  ToolCallResult,
  ToolInfo,
} from '@ujima/mcp-client';
import type { MCPDef } from '@ujima/shared';

export interface FakeMCPOptions {
  id?: string;
  tools?: ToolInfo[];
  onCall?: (ctx: ToolCallContext, toolName: string, args: unknown) => Promise<unknown> | unknown;
}

export function makeFakeMCPConnection(opts: FakeMCPOptions = {}): MCPConnection {
  const id = opts.id ?? 'fake-mcp';
  const def: MCPDef = {
    id,
    name: id,
    version: '0.0.0',
    description: '',
    category: 'general',
    transport: 'stdio',
    args: [],
    env: {},
    isolation: 'shared',
  };
  const tools = opts.tools ?? [
    {
      name: 'noop',
      description: 'no-op',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  let open = true;
  return {
    id,
    def,
    async listTools() {
      return tools;
    },
    async callTool(ctx, toolName, args): Promise<ToolCallResult> {
      const output = opts.onCall
        ? await opts.onCall(ctx, toolName, args)
        : { ok: true, toolName, args };
      return { content: [{ type: 'text', text: JSON.stringify(output) }] };
    },
    async close() {
      open = false;
    },
    isOpen() {
      return open;
    },
  };
}
