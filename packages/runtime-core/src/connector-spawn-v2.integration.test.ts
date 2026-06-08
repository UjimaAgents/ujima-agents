import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrganizationSchema, McpServerSchema, type McpToolDescriptor } from '@ujima/shared';
import { openDatabase } from '@ujima/context-store';
import {
  buildMcpToolDefinitionsV2,
  type McpRuntimeConnection,
  type SpiritMcpPool,
  type ToolInvocationInput,
  type ToolInvocationResult,
  type ToolService,
} from '@ujima/orchestrator';
import { Repository } from './repositories/index.js';

// Three load-bearing invariants for the V2 spawn:
//   1. Native attachments produce typed-palette tool entries with the
//      synthetic `mcp:<serverId>:<toolName>` permission shape — so
//      the existing governance rules apply unchanged.
//   2. Dispatch attachments do NOT produce per-tool entries; instead
//      catalogText is populated and the two meta-tools (get_connector_tools,
//      invoke_connector_tool) are present in the ToolSet.
//   3. Both meta-tools are present even when the dispatch tier is empty,
//      so the agent's tool surface stays stable across spawns.

function stubPool(): SpiritMcpPool {
  return {
    async get(): Promise<McpRuntimeConnection> {
      // Forced failure → V2 falls back to the cached tool inventory,
      // which is the path most production spawns take (cache is
      // already populated by spawn-time refresh or settings UI Test).
      throw new Error('pool unavailable in test — falls back to cache');
    },
  };
}

function stubToolService(): ToolService & {
  invocations: ToolInvocationInput[];
} {
  const stub: ToolService & { invocations: ToolInvocationInput[] } = {
    invocations: [],
    async invoke(input) {
      stub.invocations.push(input);
      return { ok: true, output: { status: 'ok' } } satisfies ToolInvocationResult;
    },
    allowRun() {
      // Stub.
    },
  };
  return stub;
}

interface Fixture {
  repo: Repository;
  orgId: string;
  memberId: string;
  tools: ReturnType<typeof stubToolService>;
  pool: SpiritMcpPool;
}

function setup(): Fixture {
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const orgId = `org_${randomUUID()}`;
  const memberId = `mem_${randomUUID()}`;
  const now = new Date().toISOString();
  repo.saveOrganization(
    OrganizationSchema.parse({
      id: orgId,
      name: 'V2 Test',
      workspace: { root: '/tmp/v2-test', roleScopes: {} },
    }),
  );
  repo.saveMember({
    id: memberId,
    organizationId: orgId,
    name: 'Snoop',
    kind: 'agent',
    roleName: 'investigator',
    presence: 'offline',
    createdAt: now,
  });
  return { repo, orgId, memberId, tools: stubToolService(), pool: stubPool() };
}

function attachServer(
  fixture: Fixture,
  serverConfig: {
    id: string;
    name: string;
    category?: string;
    tier: 'native' | 'dispatch';
    tools?: McpToolDescriptor[];
  },
) {
  const now = new Date().toISOString();
  const server = McpServerSchema.parse({
    id: serverConfig.id,
    organizationId: fixture.orgId,
    name: serverConfig.name,
    description: '',
    category: serverConfig.category ?? 'general',
    transport: 'stdio',
    command: 'true',
    args: [],
    isolation: 'shared',
    status: 'active',
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
  });
  fixture.repo.saveMcpServer(server);
  fixture.repo.saveAgentMcpAttachment({
    id: `att_${serverConfig.id}`,
    organizationId: fixture.orgId,
    memberId: fixture.memberId,
    mcpServerId: serverConfig.id,
    scope: 'worker',
    tier: serverConfig.tier,
    createdAt: now,
    updatedAt: now,
  });
  if (serverConfig.tools) {
    fixture.repo.saveMcpToolCache({
      mcpServerId: serverConfig.id,
      organizationId: fixture.orgId,
      tools: serverConfig.tools,
      fetchedAt: now,
    });
  }
}

describe('buildMcpToolDefinitionsV2 — tier partition + meta-tools', () => {
  it('native attachments produce typed tool entries; dispatch attachments do not', async () => {
    const f = setup();
    attachServer(f, {
      id: 'srv_native',
      name: 'NativeServer',
      tier: 'native',
      tools: [{ name: 'do_native_thing', description: '' }],
    });
    attachServer(f, {
      id: 'srv_dispatch',
      name: 'DispatchServer',
      tier: 'dispatch',
      tools: [{ name: 'do_dispatch_thing', description: '' }],
    });

    const v2 = await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    // Native: there's exactly one typed tool entry; servers list
    // surfaces the native server only.
    const nativeKeys = Object.keys(v2.toolSet).filter((k) => k.startsWith('mcp__'));
    expect(nativeKeys).toHaveLength(1);
    expect(v2.servers.map((s) => s.serverId)).toEqual(['srv_native']);

    // Dispatch: no per-tool entries, but catalogText is populated and
    // surfaces the dispatch server (opaque label since the server
    // isn't a CURATED_REGISTRY match).
    expect(v2.catalogText).toContain('Custom MCP (srv_dispatch)');
    expect(v2.catalogText).not.toContain('NativeServer');
    expect(v2.dispatchCatalog.map((e) => e.serverId)).toEqual(['srv_dispatch']);
  });

  it('registers both meta-tools even when the dispatch tier is empty', async () => {
    const f = setup();
    attachServer(f, {
      id: 'srv_native_only',
      name: 'OnlyNative',
      tier: 'native',
      tools: [{ name: 'thing', description: '' }],
    });

    const v2 = await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    expect(v2.toolSet).toHaveProperty('get_connector_tools');
    expect(v2.toolSet).toHaveProperty('invoke_connector_tool');
    // No dispatch entries → catalogText is empty.
    expect(v2.catalogText).toBe('');
    expect(v2.dispatchCatalog).toEqual([]);
  });

  it('native tier honors per-tool grants (parity with legacy spawn-time filter)', async () => {
    const f = setup();
    attachServer(f, {
      id: 'srv_grant',
      name: 'GrantServer',
      tier: 'native',
      tools: [
        { name: 'post_message', description: '' },
        { name: 'delete_message', description: '' },
      ],
    });
    // Grant only `post_message` to the worker. delete_message must
    // disappear from the native palette; without this the V2 path
    // would expose every tool the MCP reports regardless of grants.
    const now = new Date().toISOString();
    f.repo.saveAgentToolAttachment({
      organizationId: f.orgId,
      memberId: f.memberId,
      mcpServerId: 'srv_grant',
      toolName: 'post_message',
      scope: 'worker',
      createdAt: now,
      updatedAt: now,
    });

    const v2 = await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    const nativeKeys = Object.keys(v2.toolSet).filter((k) => k.startsWith('mcp__'));
    expect(nativeKeys).toHaveLength(1);
    // The server itself stays in the servers summary because at least
    // one tool survived the filter; the toolNames list reflects only
    // the granted slice.
    expect(v2.servers.map((s) => s.serverId)).toEqual(['srv_grant']);
    expect(v2.servers[0]?.toolNames).toEqual(['post_message']);
  });

  it('native tier seeds mcp_tool_classifications even when live refresh fails (cache-fallback path)', async () => {
    // stubPool() throws → V2 falls back to cached tools. The seed
    // block was previously inside the refresh try, so the seed
    // silently skipped on every transient MCP outage. After the
    // restructure both cache fallback and refresh success seed.
    const f = setup();
    attachServer(f, {
      id: 'srv_seed_native',
      name: 'SeedNative',
      tier: 'native',
      tools: [
        { name: 'read_thing', description: 'Reads' },
        { name: 'write_thing', description: 'Writes' },
      ],
    });

    await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    const classifications = f.repo
      .listMcpToolClassifications(f.orgId)
      .filter((c) => c.mcpServerId === 'srv_seed_native');
    expect(classifications.map((c) => c.toolName).sort()).toEqual(
      ['read_thing', 'write_thing'].sort(),
    );
  });

  it('dispatch tier also seeds mcp_tool_classifications so risk_defaults fires on first invoke', async () => {
    // The bot caught this: V2 used to seed only inside the
    // nativeAttachments loop. A dispatch-only attachment would have
    // no classification row, so evaluatePolicy returned 'inherit'
    // and risk_defaults.destructive=require_approval silently
    // stopped applying for the entire dispatch path.
    const f = setup();
    attachServer(f, {
      id: 'srv_seed_dispatch',
      name: 'SeedDispatch',
      tier: 'dispatch',
      tools: [
        { name: 'post_message', description: 'Posts' },
        { name: 'delete_message', description: 'Deletes' },
      ],
    });

    await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    const classifications = f.repo
      .listMcpToolClassifications(f.orgId)
      .filter((c) => c.mcpServerId === 'srv_seed_dispatch');
    expect(classifications.map((c) => c.toolName).sort()).toEqual(
      ['delete_message', 'post_message'],
    );
  });

  it('native tool execute routes through ToolService.invoke with the synthetic mcp:<id>:<name> shape', async () => {
    const f = setup();
    attachServer(f, {
      id: 'srv_x',
      name: 'X',
      tier: 'native',
      tools: [{ name: 'do_thing', description: 'Does it' }],
    });

    const v2 = await buildMcpToolDefinitionsV2(
      { mcpPool: f.pool, repo: f.repo, tools: f.tools },
      {
        organizationId: f.orgId,
        memberId: f.memberId,
        runId: 'run_test',
        threadId: 'thread_test',
        taskSessionId: 'task_test',
        role: 'worker',
      },
    );

    const nativeKey = Object.keys(v2.toolSet).find((k) => k.startsWith('mcp__'))!;
    const nativeTool = v2.toolSet[nativeKey];
    expect(nativeTool).toBeDefined();
    const execute = nativeTool!.execute!;
    // Execute the native tool's wrapper and confirm the routing shape.
    await execute(
      { some_arg: 'value' },
      { toolCallId: 'call_1' } as Parameters<typeof execute>[1],
    );
    expect(f.tools.invocations).toHaveLength(1);
    const inv = f.tools.invocations[0]!;
    expect(inv.permissionMcpId).toBe('srv_x');
    expect(inv.permissionToolName).toBe('mcp:srv_x:do_thing');
    expect(inv.toolId).toBe('mcp');
    expect(inv.resourceType).toBe('mcp');
    expect(inv.input).toEqual({
      mcpServerId: 'srv_x',
      mcpServerName: 'X',
      toolName: 'do_thing',
      args: { some_arg: 'value' },
    });
  });
});
