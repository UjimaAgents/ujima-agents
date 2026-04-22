import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPDef } from '@ujima/shared';
import { createMCPPool, type MCPPool } from './pool';
import { makeInMemoryTransportPair } from './test-helpers';

function defFor(id: string): MCPDef {
  return {
    id,
    name: id,
    version: '0.0.0',
    description: '',
    category: 'general',
    transport: 'stdio',
    command: 'noop',
    args: [],
    env: {},
    isolation: 'shared',
  };
}

async function startBuiltInServer(): Promise<{
  server: McpServer;
  clientTransport: ReturnType<typeof makeInMemoryTransportPair>[0];
}> {
  const [clientT, serverT] = makeInMemoryTransportPair();
  const server = new McpServer({ name: 's', version: '0.0.0' });
  server.tool('echo', { msg: z.string() }, async ({ msg }) => ({
    content: [{ type: 'text' as const, text: msg }],
  }));
  await server.connect(serverT);
  return { server, clientTransport: clientT };
}

describe('MCP connection pool', () => {
  let pool: MCPPool;
  const servers: McpServer[] = [];

  afterEach(async () => {
    await pool?.closeAll();
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });

  it('returns the same connection for repeated get() calls', async () => {
    const { server, clientTransport } = await startBuiltInServer();
    servers.push(server);
    pool = createMCPPool({ transport: clientTransport });
    const c1 = await pool.get(defFor('A'));
    const c2 = await pool.get(defFor('A'));
    expect(c1).toBe(c2);
    expect(pool.size()).toBe(1);
  });

  it('closeOne closes and removes a single connection', async () => {
    const { server, clientTransport } = await startBuiltInServer();
    servers.push(server);
    pool = createMCPPool({ transport: clientTransport });
    await pool.get(defFor('A'));
    expect(pool.has('A')).toBe(true);
    await pool.closeOne('A');
    expect(pool.has('A')).toBe(false);
  });

  it('keys per-agent-isolated MCPs separately from the shared bucket', async () => {
    const { server, clientTransport } = await startBuiltInServer();
    servers.push(server);
    pool = createMCPPool({ transport: clientTransport });

    const isolatedDef: MCPDef = { ...defFor('playwright'), isolation: 'per-agent' };
    await pool.get(isolatedDef, { agentId: 'a1' });

    expect(pool.has('playwright', { agentId: 'a1' })).toBe(true);
    expect(pool.has('playwright')).toBe(false);
  });
});
