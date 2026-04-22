import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPDef } from '@ujima/shared';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { connectMCP, isConnectionClosedError, type MCPConnection } from './connection';
import { makeInMemoryTransportPair } from './test-helpers';

const def: MCPDef = {
  id: 'test-mcp',
  name: 'Test',
  version: '0.0.0',
  description: '',
  category: 'general',
  transport: 'stdio',
  command: 'noop',
  args: [],
  env: {},
  isolation: 'shared',
};

async function startServer(options?: {
  onCall?: (name: string) => void;
  toolDelayMs?: number;
}): Promise<{ server: McpServer; clientTransport: Transport }> {
  const [clientT, serverT] = makeInMemoryTransportPair();
  const server = new McpServer({ name: 'test-server', version: '0.0.0' });
  server.tool('echo', { msg: z.string() }, async ({ msg }) => {
    options?.onCall?.('echo');
    if (options?.toolDelayMs) await new Promise((r) => setTimeout(r, options.toolDelayMs));
    return { content: [{ type: 'text' as const, text: msg }] };
  });
  server.tool('add', { a: z.number(), b: z.number() }, async ({ a, b }) => {
    options?.onCall?.('add');
    return { content: [{ type: 'text' as const, text: String(a + b) }] };
  });
  await server.connect(serverT);
  return { server, clientTransport: clientT };
}

describe('MCP connection', () => {
  let server: McpServer;
  let conn: MCPConnection;

  afterEach(async () => {
    await conn?.close();
    await server?.close();
  });

  it('lists tools advertised by the server', async () => {
    const { server: s, clientTransport } = await startServer();
    server = s;
    conn = await connectMCP(def, { transport: clientTransport });
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['add', 'echo']);
  });

  it('calls a tool and returns its content', async () => {
    const { server: s, clientTransport } = await startServer();
    server = s;
    conn = await connectMCP(def, { transport: clientTransport });
    const result = await conn.callTool({ agentId: 'a1' }, 'echo', { msg: 'hi' });
    expect(result.isError).toBe(undefined);
    expect(JSON.stringify(result.content)).toContain('hi');
  });

  it('invokes onToolCall with agent tag, duration and result', async () => {
    const { server: s, clientTransport } = await startServer();
    server = s;
    const calls: { agentId: string; mcpId: string; tool: string }[] = [];
    conn = await connectMCP(def, {
      transport: clientTransport,
      onToolCall: (ctx, mcpId, tool) => {
        calls.push({ agentId: ctx.agentId, mcpId, tool });
      },
    });
    await conn.callTool({ agentId: 'sr-designer', taskId: 't1' }, 'echo', { msg: 'x' });
    expect(calls).toEqual([{ agentId: 'sr-designer', mcpId: 'test-mcp', tool: 'echo' }]);
  });

  it('serializes concurrent tool calls through the queue', async () => {
    const order: string[] = [];
    const { server: s, clientTransport } = await startServer({
      onCall: (name) => order.push(`start:${name}`),
      toolDelayMs: 20,
    });
    server = s;
    conn = await connectMCP(def, { transport: clientTransport });
    await Promise.all([
      conn.callTool({ agentId: 'a1' }, 'echo', { msg: '1' }),
      conn.callTool({ agentId: 'a2' }, 'echo', { msg: '2' }),
      conn.callTool({ agentId: 'a3' }, 'echo', { msg: '3' }),
    ]);
    expect(order).toEqual(['start:echo', 'start:echo', 'start:echo']);
  });

  it('isOpen reflects close()', async () => {
    const { server: s, clientTransport } = await startServer();
    server = s;
    conn = await connectMCP(def, { transport: clientTransport });
    expect(conn.isOpen()).toBe(true);
    await conn.close();
    expect(conn.isOpen()).toBe(false);
  });
});

describe('isConnectionClosedError', () => {
  it('matches playwright closed-target messages', () => {
    expect(
      isConnectionClosedError(new Error('Target page, context or browser has been closed')),
    ).toBe(true);
    expect(isConnectionClosedError(new Error('Target closed'))).toBe(true);
    expect(isConnectionClosedError(new Error('Browser has been closed'))).toBe(true);
  });

  it('matches transport-level close messages', () => {
    expect(isConnectionClosedError(new Error('transport is closed'))).toBe(true);
    expect(isConnectionClosedError(new Error('Connection closed before response'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isConnectionClosedError(new Error('invalid argument: msg'))).toBe(false);
    expect(isConnectionClosedError('rate limited')).toBe(false);
    expect(isConnectionClosedError(undefined)).toBe(false);
  });

  it('handles string inputs', () => {
    expect(isConnectionClosedError('Target closed')).toBe(true);
  });
});
