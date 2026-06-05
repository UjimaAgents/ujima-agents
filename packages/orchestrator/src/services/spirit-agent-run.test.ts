import { describe, expect, it, vi } from 'vitest';
import type { ApiRepository } from './repository-reader.js';
import type { SpiritMcpResolution } from './spirit-types.js';
import { SpiritService } from './spirit.js';

// Regression: pre-fix `buildMcpToolDefinitions` wrapped both the live
// `listTools` call AND the post-fetch cache/classification writes in a
// single try/catch. A transient DB lock during saveMcpToolCache landed
// in the catch and threw away the freshly fetched live tools, replacing
// the agent's palette with stale cache data or an empty list. The fix
// isolates the two failure modes so seed-write errors are logged but
// don't drop tools the MCP just confirmed exist.

function makeMockRepo(overrides: Partial<ApiRepository>): ApiRepository {
  // Minimum the buildMcpToolDefinitions path touches. Anything not
  // overridden becomes a no-op stub.
  const base: Partial<ApiRepository> = {
    listAgentToolAttachments: () => [],
    getMcpToolCache: () => null,
    saveMcpToolCache: () => ({
      mcpServerId: '',
      organizationId: '',
      tools: [],
      fetchedAt: new Date().toISOString(),
    }),
    seedInferredClassifications: () => 0,
  };
  return { ...base, ...overrides } as ApiRepository;
}

const MCP_DEF = {
  id: 'mcp_x',
  name: 'mcp_x',
  version: '0.0.0',
  description: '',
  category: 'browser',
  transport: 'stdio' as const,
  command: 'x',
  args: [],
  env: {},
  isolation: 'shared' as const,
};

const RESOLUTIONS: SpiritMcpResolution[] = [
  {
    def: MCP_DEF,
    serverId: 'srv_a',
    serverName: 'srv_a',
  },
];

const LIVE_TOOLS = [
  { name: 'tool_a', description: 'reads', inputSchema: { type: 'object' } },
  { name: 'tool_b', description: 'writes', inputSchema: { type: 'object' } },
];

function makeService(repoOverrides: Partial<ApiRepository>, realtimeOverrides?: { emit?: (...args: any[]) => void }) {
  const repo = makeMockRepo(repoOverrides);
  const pool = {
    async get() {
      return {
        listTools: async () => LIVE_TOOLS,
        callTool: async () => ({ content: 'ok' }),
        close: async () => undefined,
      };
    },
  };
  const tools = {
    invoke: async () => ({ ok: true, output: 'ok' }),
  };
  return new SpiritService(
    {} as never,
    repo,
    { emit: realtimeOverrides?.emit ?? (() => undefined) } as never,
    tools as never,
    {
      mcpPool: pool as never,
      mcpResolver: async () => RESOLUTIONS,
    },
  );
}

describe('SpiritServiceAgentRun.buildMcpToolDefinitions', () => {
  it('keeps the fresh live tools when saveMcpToolCache throws', async () => {
    const cacheGet = vi.fn(() => null);
    const cacheSave = vi.fn(() => {
      throw new Error('database is locked');
    });
    const service = makeService({
      saveMcpToolCache: cacheSave as never,
      getMcpToolCache: cacheGet as never,
    });

    const result = await service.buildMcpToolDefinitions({
      organizationId: 'org-1',
      memberId: 'agent-1',
      runId: 'run-1',
      threadId: 'th-1',
      taskSessionId: 'task-1',
      role: 'worker',
    });

    // The fresh liveTools survived the seed-write failure.
    expect(Object.keys(result.toolSet)).toHaveLength(LIVE_TOOLS.length);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.toolNames.sort()).toEqual(['tool_a', 'tool_b']);
    // Cache fallback was NOT used.
    expect(cacheGet).not.toHaveBeenCalled();
  });

  it('keeps the fresh live tools when seedInferredClassifications throws', async () => {
    const cacheGet = vi.fn(() => null);
    const seedSpy = vi.fn(() => {
      throw new Error('classifications table missing');
    });
    const service = makeService({
      seedInferredClassifications: seedSpy as never,
      getMcpToolCache: cacheGet as never,
    });

    const result = await service.buildMcpToolDefinitions({
      organizationId: 'org-1',
      memberId: 'agent-1',
      runId: 'run-1',
      threadId: 'th-1',
      taskSessionId: 'task-1',
      role: 'worker',
    });

    expect(Object.keys(result.toolSet)).toHaveLength(LIVE_TOOLS.length);
    expect(result.servers[0]!.toolNames.sort()).toEqual(['tool_a', 'tool_b']);
    expect(cacheGet).not.toHaveBeenCalled();
  });

  it('falls back to cached tools ONLY when the live listTools call fails', async () => {
    const cached = [
      { name: 'cached_tool', description: '', inputSchema: { type: 'object' } },
    ];
    const repo = makeMockRepo({
      getMcpToolCache: () => ({
        mcpServerId: 'srv_a',
        organizationId: 'org-1',
        tools: cached,
        fetchedAt: new Date().toISOString(),
      }),
    });
    const brokenPool = {
      async get() {
        return {
          listTools: async () => {
            throw new Error('MCP connection refused');
          },
          callTool: async () => ({ content: 'ok' }),
          close: async () => undefined,
        };
      },
    };
    const service = new SpiritService(
      {} as never,
      repo,
      { emit: () => undefined } as never,
      { invoke: async () => ({ ok: true, output: 'ok' }) } as never,
      {
        mcpPool: brokenPool as never,
        mcpResolver: async () => RESOLUTIONS,
      },
    );

    const result = await service.buildMcpToolDefinitions({
      organizationId: 'org-1',
      memberId: 'agent-1',
      runId: 'run-1',
      threadId: 'th-1',
      taskSessionId: 'task-1',
      role: 'worker',
    });

    expect(result.servers[0]!.toolNames).toEqual(['cached_tool']);
  });

});
