import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { McpRegistryService } from '@ujima/orchestrator';
import type { MCPConnection } from '@ujima/mcp-client';
import { mapMcpRouteError } from '../src/transport/routes/mcps.js';
import { createOnboardedFixture } from './helpers/create-onboarded-fixture.js';

// Phase 3 of the MCP integration — covers the registry CRUD + JSON
// import path + per-agent attachments + the redaction contract that
// keeps env/header secrets off the API surface. Connection-test +
// runtime spirit integration paths live in `spirits.int.test.ts`
// (or are exercised lazily through the spirit MCP path).

async function createFixture() {
  const onboarded = await createOnboardedFixture({
    organizationName: 'MCP Org',
    team: {
      channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      roles: [
        {
          name: 'engineer',
          title: 'Engineer',
          instructions: 'Engineer role',
          workspaceScopes: ['apps/web'],
          tools: ['filesystem'],
          channels: ['general'],
        },
      ],
      agents: [{ name: 'agent-x', roleName: 'engineer', personalityName: 'direct' }],
    },
  });
  return {
    ...onboarded,
    registry: new McpRegistryService(onboarded.repo),
  };
}

describe('McpRegistryService — Phase 3 MCP integration', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates a server, stores env behind a key_ref, and never leaks secret material in the public shape', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'github',
      description: 'GitHub MCP',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'ghp_super_secret_value' },
    });

    // Public shape: hasEnv true, envKeys names the key but never the value.
    expect(server.hasEnv).toBe(true);
    expect(server.envKeys).toEqual(['GITHUB_TOKEN']);
    // No `envKeyRef` field on the public shape.
    expect((server as unknown as { envKeyRef?: string }).envKeyRef).toBeUndefined();
    // Serialised response must NOT contain the secret.
    expect(JSON.stringify(server)).not.toContain('ghp_super_secret_value');

    // The persisted row has a key_ref, and reading via the secret
    // store round-trips the env map.
    const row = fixture.repo.getMcpServer(fixture.organizationId, server.id);
    expect(row?.envKeyRef).toBeDefined();
    const raw = fixture.repo.readSecret(row!.envKeyRef!);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({ GITHUB_TOKEN: 'ghp_super_secret_value' });
  });

  it('rejects duplicate names within an organisation', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'fs',
      transport: 'stdio',
      command: 'node',
      args: ['fs.js'],
    });

    expect(() =>
      fixture.registry.create({
        organizationId: fixture.organizationId,
        createdBy: fixture.ownerId,
        name: 'fs',
        transport: 'stdio',
        command: 'node',
        args: ['fs.js'],
      }),
    ).toThrow(/already exists/);
  });

  it('rejects duplicate names after trimming create input', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'trimmed',
      transport: 'stdio',
      command: 'node',
    });

    expect(() =>
      fixture.registry.create({
        organizationId: fixture.organizationId,
        createdBy: fixture.ownerId,
        name: 'trimmed ',
        transport: 'stdio',
        command: 'node',
      }),
    ).toThrow(/already exists/);
  });

  it('cleans newly written secrets when create fails after secret writes', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);
    const originalWriteSecret = fixture.repo.writeSecret;
    const originalSaveMcpServer = fixture.repo.saveMcpServer;
    const writtenSecretRefs: string[] = [];
    fixture.repo.writeSecret = ((value: string) => {
      const keyRef = originalWriteSecret(value);
      writtenSecretRefs.push(keyRef);
      return keyRef;
    }) as typeof fixture.repo.writeSecret;
    fixture.repo.saveMcpServer = (() => {
      throw new Error('save failed');
    }) as typeof fixture.repo.saveMcpServer;

    try {
      expect(() =>
        fixture.registry.create({
          organizationId: fixture.organizationId,
          createdBy: fixture.ownerId,
          name: 'fragile',
          transport: 'stdio',
          command: 'fragile-cli',
          env: { TOKEN: 'new-token' },
          headers: { authorization: 'Bearer new' },
        }),
      ).toThrow(/save failed/);
    } finally {
      fixture.repo.writeSecret = originalWriteSecret;
      fixture.repo.saveMcpServer = originalSaveMcpServer;
    }

    expect(writtenSecretRefs).toHaveLength(2);
    for (const keyRef of writtenSecretRefs) {
      expect(fixture.repo.readSecret(keyRef)).toBeNull();
    }
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'fragile')).toBeNull();
  });

  it('keeps existing secret refs intact when an update fails before save', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const first = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'first',
      transport: 'stdio',
      command: 'first-cli',
      env: { TOKEN: 'old-token' },
      headers: { authorization: 'Bearer old' },
    });
    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'second',
      transport: 'stdio',
      command: 'second-cli',
    });

    const before = fixture.repo.getMcpServer(fixture.organizationId, first.id);
    const envKeyRef = before?.envKeyRef;
    const headersKeyRef = before?.headersKeyRef;
    expect(envKeyRef).toBeDefined();
    expect(headersKeyRef).toBeDefined();
    expect(fixture.repo.readSecret(envKeyRef!)).toBe(JSON.stringify({ TOKEN: 'old-token' }));
    expect(fixture.repo.readSecret(headersKeyRef!)).toBe(JSON.stringify({ authorization: 'Bearer old' }));

    expect(() =>
      fixture.registry.update({
        organizationId: fixture.organizationId,
        serverId: first.id,
        name: 'second',
        env: { TOKEN: 'new-token' },
        headers: { authorization: 'Bearer new' },
      }),
    ).toThrow(/already exists/);

    const after = fixture.repo.getMcpServer(fixture.organizationId, first.id);
    expect(after?.envKeyRef).toBe(envKeyRef);
    expect(after?.headersKeyRef).toBe(headersKeyRef);
    expect(fixture.repo.readSecret(envKeyRef!)).toBe(JSON.stringify({ TOKEN: 'old-token' }));
    expect(fixture.repo.readSecret(headersKeyRef!)).toBe(JSON.stringify({ authorization: 'Bearer old' }));
  });

  it('cleans newly written secrets when import fails after secret writes', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);
    const originalWriteSecret = fixture.repo.writeSecret;
    const originalSaveMcpServer = fixture.repo.saveMcpServer;
    const writtenSecretRefs: string[] = [];
    fixture.repo.writeSecret = ((value: string) => {
      const keyRef = originalWriteSecret(value);
      writtenSecretRefs.push(keyRef);
      return keyRef;
    }) as typeof fixture.repo.writeSecret;
    fixture.repo.saveMcpServer = (() => {
      throw new Error('save failed');
    }) as typeof fixture.repo.saveMcpServer;

    try {
      expect(() =>
        fixture.registry.import({
          organizationId: fixture.organizationId,
          createdBy: fixture.ownerId,
          json: JSON.stringify({
            mcpServers: {
              fragile: {
                command: 'fragile-cli',
                env: { TOKEN: 'new-token' },
                headers: { authorization: 'Bearer new' },
              },
            },
          }),
        }),
      ).toThrow(/save failed/);
    } finally {
      fixture.repo.writeSecret = originalWriteSecret;
      fixture.repo.saveMcpServer = originalSaveMcpServer;
    }

    expect(writtenSecretRefs).toHaveLength(2);
    for (const keyRef of writtenSecretRefs) {
      expect(fixture.repo.readSecret(keyRef)).toBeNull();
    }
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'fragile')).toBeNull();
  });

  it('imports Claude Desktop JSON, dedupes pre-existing names, and surfaces parse warnings', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'fs',
      transport: 'stdio',
      command: 'node',
      args: ['fs.js'],
    });

    const json = JSON.stringify({
      mcpServers: {
        fs: { command: 'node', args: ['fs.js'] },
        github: { command: 'npx', args: ['-y', 'gh-server'], env: { GITHUB_TOKEN: 'tok' } },
      },
    });

    const result = fixture.registry.import({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      json,
    });

    expect(result.imported.map((s) => s.name)).toEqual(['github']);
    expect(result.skipped.map((s) => s.name)).toEqual(['fs']);
    expect(result.skipped[0]!.reason).toMatch(/already exists/i);
    // Imported server's GitHub env is stored — public shape shows the key only.
    expect(result.imported[0]!.envKeys).toEqual(['GITHUB_TOKEN']);
    expect(JSON.stringify(result)).not.toContain('"tok"');
  });

  it('normalizes imported names before duplicate checks and persistence', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'fs',
      transport: 'stdio',
      command: 'node',
    });

    const result = fixture.registry.import({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      json: JSON.stringify({
        mcpServers: {
          'fs-copy': {
            name: 'fs ',
            command: 'node',
          },
          'trimmed-new': {
            name: ' trimmed-new ',
            command: 'node',
          },
        },
      }),
    });

    expect(result.imported.map((server) => server.name)).toEqual(['trimmed-new']);
    expect(result.skipped).toEqual([
      {
        name: 'fs',
        reason: 'A server with this name already exists in the organisation',
      },
    ]);
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'fs ')).toBeNull();
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'trimmed-new')).toBeTruthy();
  });

  it('skips imported MCP entries that fail transport connectivity validation', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const result = fixture.registry.import({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      json: JSON.stringify({
        mcpServers: {
          'stdio-missing-command': {
            transport: 'stdio',
          },
          'remote-missing-url': {
            transport: 'sse',
          },
          valid: {
            transport: 'http-streamable',
            url: 'https://valid.example/mcp',
          },
        },
      }),
    });

    expect(result.imported.map((server) => server.name)).toEqual(['valid']);
    expect(result.skipped).toEqual([
      {
        name: 'stdio-missing-command',
        reason: 'stdio MCP servers require a command',
      },
      {
        name: 'remote-missing-url',
        reason: 'sse MCP servers require a url',
      },
    ]);
    expect(
      fixture.repo.getMcpServerByName(fixture.organizationId, 'stdio-missing-command'),
    ).toBeNull();
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'remote-missing-url')).toBeNull();
    expect(fixture.repo.getMcpServerByName(fixture.organizationId, 'valid')).toBeTruthy();
  });

  it('list() returns redacted shapes ordered by name', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'zeta',
      transport: 'http-streamable',
      url: 'https://zeta.example/mcp',
    });
    fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'alpha',
      transport: 'stdio',
      command: 'alpha-cli',
    });

    const servers = fixture.registry.list(fixture.organizationId);
    expect(servers.map((s) => s.name)).toEqual(['alpha', 'zeta']);
    expect(servers[0]!.hasEnv).toBe(false);
    expect(servers[1]!.hasEnv).toBe(false);
  });

  it('attach + detach: per-agent attachment with scope, blocks supervisor-only access from worker queries', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'time',
      transport: 'stdio',
      command: 'time-server',
    });

    // Default scope is 'worker' — worker-role spirits see it,
    // supervisor-role spirits do not.
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
    });

    const workerView = fixture.repo.listAttachedServersForSpirit(
      fixture.organizationId,
      'agent-x',
      'worker',
    );
    expect(workerView.map((row) => row.server.name)).toEqual(['time']);
    expect(workerView[0]!.attachment.scope).toBe('worker');

    const supervisorView = fixture.repo.listAttachedServersForSpirit(
      fixture.organizationId,
      'agent-x',
      'supervisor',
    );
    expect(supervisorView).toHaveLength(0);

    // Detach removes the row.
    fixture.registry.detach(fixture.organizationId, 'agent-x', server.id);
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'worker'),
    ).toHaveLength(0);
  });

  it('attach with scope=both surfaces the MCP to both spirit roles', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'shared',
      transport: 'stdio',
      command: 'shared-cli',
    });

    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'both',
    });

    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'worker'),
    ).toHaveLength(1);
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'supervisor'),
    ).toHaveLength(1);
  });

  it('delete cascades attachments + tool cache + secret material', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'cleanup',
      transport: 'stdio',
      command: 'x',
      env: { SECRET: 'val' },
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
    });
    // Seed the tool cache so we can check it's gone too.
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'demo', description: '', inputSchema: undefined }],
      fetchedAt: new Date().toISOString(),
    });

    const row = fixture.repo.getMcpServer(fixture.organizationId, server.id);
    const envKeyRef = row!.envKeyRef!;
    expect(fixture.repo.readSecret(envKeyRef)).toBeTruthy();

    fixture.registry.delete(fixture.organizationId, server.id);
    expect(fixture.repo.getMcpServer(fixture.organizationId, server.id)).toBeNull();
    expect(
      fixture.repo.listAgentMcpAttachments(fixture.organizationId, 'agent-x'),
    ).toHaveLength(0);
    expect(fixture.repo.getMcpToolCache(fixture.organizationId, server.id)).toBeNull();
    // Secret material removed from the file-backed store.
    expect(fixture.repo.readSecret(envKeyRef)).toBeNull();
  });

  it('rejects attach on retired / non-agent members + on disabled servers', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'guarded',
      transport: 'stdio',
      command: 'g',
    });
    fixture.registry.update({
      organizationId: fixture.organizationId,
      serverId: server.id,
      status: 'disabled',
    });

    expect(() =>
      fixture.registry.attach({
        organizationId: fixture.organizationId,
        memberId: 'agent-x',
        mcpServerId: server.id,
      }),
    ).toThrow(/disabled/);

    fixture.registry.update({
      organizationId: fixture.organizationId,
      serverId: server.id,
      status: 'active',
    });
    expect(() =>
      fixture.registry.attach({
        organizationId: fixture.organizationId,
        memberId: fixture.ownerId,
        mcpServerId: server.id,
      }),
    ).toThrow(/non-agent/);

    const alice = fixture.repo.getMember(fixture.organizationId, 'agent-x');
    fixture.repo.saveMember({ ...alice!, retiredAt: new Date().toISOString() });
    expect(() =>
      fixture.registry.attach({
        organizationId: fixture.organizationId,
        memberId: 'agent-x',
        mcpServerId: server.id,
      }),
    ).toThrow(/retired/);
  });

  it('test() does not reactivate a disabled MCP server on success', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);
    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'disabled-test',
      transport: 'stdio',
      command: 'x',
    });
    fixture.registry.update({
      organizationId: fixture.organizationId,
      serverId: server.id,
      status: 'disabled',
    });
    const disabledBefore = fixture.repo.getMcpServer(fixture.organizationId, server.id);
    expect(disabledBefore?.status).toBe('disabled');
    const registry = new McpRegistryService(fixture.repo, async () => ({
      id: 'mock-connection',
      def: {} as never,
      listTools: async () => [{ name: 'ping', description: 'Ping' }],
      callTool: async () => ({ content: { ok: true } }),
      close: async () => undefined,
      isOpen: () => true,
    }));

    const result = await registry.test(fixture.organizationId, server.id);

    expect(result.ok).toBe(true);
    const after = fixture.repo.getMcpServer(fixture.organizationId, server.id);
    expect(after?.status).toBe('disabled');
    expect(after?.lastTestedAt).toBe(result.testedAt);
    expect(after?.lastTestError).toBeUndefined();
    expect(fixture.repo.getMcpToolCache(fixture.organizationId, server.id)?.tools).toEqual([
      { name: 'ping', description: 'Ping', inputSchema: undefined },
    ]);
  });

  // -------------------------------------------------------------------
  // NEW (audit fix): a member retired AFTER MCPs were attached must
  // STOP resolving those attachments at runtime. `attach()` already
  // blocks new bindings for retired members; this test guards the
  // other half of the boundary — the runtime lookup the spirit uses.
  // -------------------------------------------------------------------
  it('listAttachedServersForSpirit filters retired members at the SQL layer', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'pre-retire',
      transport: 'stdio',
      command: 'x',
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'both',
    });

    // Before retirement: spirit-shaped lookups see the attachment.
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'worker'),
    ).toHaveLength(1);
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'supervisor'),
    ).toHaveLength(1);

    // Retire the member AFTER attachment.
    const alice = fixture.repo.getMember(fixture.organizationId, 'agent-x');
    fixture.repo.saveMember({ ...alice!, retiredAt: new Date().toISOString() });

    // After retirement: BOTH role lookups must return zero so the
    // running spirit can't keep invoking the MCP. Pre-fix, only
    // attach() blocked new bindings — the runtime lookup happily
    // returned the existing attachment.
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'worker'),
    ).toHaveLength(0);
    expect(
      fixture.repo.listAttachedServersForSpirit(fixture.organizationId, 'agent-x', 'supervisor'),
    ).toHaveLength(0);

    // The attachment row itself is preserved — retirement is a soft
    // disable on the member, not a cascade-delete of attachments.
    // (If the member is un-retired the attachment becomes live again
    // without the operator having to re-attach.)
    expect(
      fixture.repo.listAgentMcpAttachments(fixture.organizationId, 'agent-x'),
    ).toHaveLength(1);
  });

  // Regression: `allowlistAgents` is per (server) and surfaces only
  // those agents whose per-(agent, server) grant set is non-empty.
  // Prior UI code computed exposure from `tool.grantedAgents.length`
  // — a server-wide aggregate — so a peer-tool grant would
  // incorrectly hide unrelated tools from other attached agents.
  it('getCatalog: server.allowlistAgents is per-(agent, server) and does not leak across peers', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    // Two agents on the same MCP. Agent A receives a per-tool grant
    // (allowlist mode); agent B is attached but has no per-tool rows.
    const memberB = fixture.repo.saveMember({
      id: 'agent-y',
      organizationId: fixture.organizationId,
      name: 'agent-y',
      kind: 'agent',
      roleName: 'engineer',
      presence: 'offline',
      createdAt: new Date().toISOString(),
    });

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'split-mcp',
      transport: 'stdio',
      command: 'x',
    });
    // Pre-seed the tool cache so getCatalog has something to render.
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [
        { name: 'tool_a', description: 'reads a thing' },
        { name: 'tool_b', description: 'reads another' },
      ],
      fetchedAt: new Date().toISOString(),
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'worker',
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: memberB.id,
      mcpServerId: server.id,
      scope: 'worker',
    });
    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 'tool_a',
    });

    const catalog = fixture.registry.getCatalog(fixture.organizationId);
    const row = catalog.servers.find((s) => s.id === server.id)!;

    // The server lists A in allowlist mode and B as plain-attached.
    expect(row.allowlistAgents.sort()).toEqual(['agent-x']);

    // Per-tool grant agents are still tool-specific (this is the
    // existing contract — only A is granted on tool_a).
    const toolA = row.tools.find((t) => t.name === 'tool_a')!;
    const toolB = row.tools.find((t) => t.name === 'tool_b')!;
    expect(toolA.grantedAgents).toEqual(['agent-x']);
    expect(toolB.grantedAgents).toEqual([]);
    // Both agents remain attached at the MCP level.
    expect(toolA.attachedAgents.sort()).toEqual(['agent-x', 'agent-y']);
    expect(toolB.attachedAgents.sort()).toEqual(['agent-x', 'agent-y']);
  });

  // Same regression at the per-agent perspective: when `?agentId=X`
  // is passed, `exposed` MUST reflect X's own (agent, server) state,
  // not a different agent's grants on the same server.
  it('getCatalog(?agentId): exposure decisions are scoped per (agent, server)', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    fixture.repo.saveMember({
      id: 'agent-y',
      organizationId: fixture.organizationId,
      name: 'agent-y',
      kind: 'agent',
      roleName: 'engineer',
      presence: 'offline',
      createdAt: new Date().toISOString(),
    });
    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'per-agent-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [
        { name: 'tool_a', description: '' },
        { name: 'tool_b', description: '' },
      ],
      fetchedAt: new Date().toISOString(),
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'worker',
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-y',
      mcpServerId: server.id,
      scope: 'worker',
    });
    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 'tool_a',
    });

    // Agent A is in allowlist mode → exposed only for granted tool_a.
    const viewA = fixture.registry
      .getCatalog(fixture.organizationId, 'agent-x')
      .agentView!;
    expect(viewA[`${server.id}::tool_a`]?.exposed).toBe(true);
    expect(viewA[`${server.id}::tool_a`]?.exposureReason).toBe('granted');
    expect(viewA[`${server.id}::tool_b`]?.exposed).toBe(false);
    expect(viewA[`${server.id}::tool_b`]?.exposureReason).toBe('no-tool-grant');

    // Agent B has no per-tool grants → all-tools mode, both exposed.
    // Pre-fix this could regress because a peer agent's grant
    // affected aggregated counts.
    const viewB = fixture.registry
      .getCatalog(fixture.organizationId, 'agent-y')
      .agentView!;
    expect(viewB[`${server.id}::tool_a`]?.exposed).toBe(true);
    expect(viewB[`${server.id}::tool_a`]?.exposureReason).toBe('all-tools-mode');
    expect(viewB[`${server.id}::tool_b`]?.exposed).toBe(true);
    expect(viewB[`${server.id}::tool_b`]?.exposureReason).toBe('all-tools-mode');
  });

  // Regression: a phantom toolName must NOT persist. Pre-fix, granting
  // an unknown tool would write a row that flipped the agent into an
  // empty-allowlist mode for the server, and the runtime palette
  // filter would strip every real tool — the server would vanish from
  // the agent's prompt context entirely.
  it('grantToolToAgent: rejects an unknown tool name and writes nothing', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'phantom-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'real_tool', description: '' }],
      fetchedAt: new Date().toISOString(),
    });

    expect(() =>
      fixture.registry.grantToolToAgent({
        organizationId: fixture.organizationId,
        memberId: 'agent-x',
        mcpServerId: server.id,
        toolName: 'phantom_tool',
      }),
    ).toThrow(/Tool not found/);

    // Neither the per-tool grant nor the auto-attach happened.
    expect(
      fixture.repo.listAgentToolAttachments(fixture.organizationId, 'agent-x', server.id),
    ).toHaveLength(0);
    expect(
      fixture.repo
        .listAgentMcpAttachments(fixture.organizationId, 'agent-x')
        .filter((a) => a.mcpServerId === server.id),
    ).toHaveLength(0);
  });

  // Regression: classification PATCH used to write the manual row
  // first and only check whether the tool existed afterwards, so a
  // typo persisted a row that a future tool with the same name would
  // inherit.
  it('setToolClassification: rejects unknown tool name with no manual row written', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'classify-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'real_tool', description: '' }],
      fetchedAt: new Date().toISOString(),
    });

    expect(() =>
      fixture.registry.setToolClassification({
        organizationId: fixture.organizationId,
        serverId: server.id,
        toolName: 'phantom_tool',
        risk: 'destructive',
        updatedBy: 'admin',
      }),
    ).toThrow(/Tool not found/);

    expect(
      fixture.repo.getMcpToolClassification(
        fixture.organizationId,
        server.id,
        'phantom_tool',
      ),
    ).toBeNull();
  });

  // Bot finding: a per-tool grant that auto-attaches the MCP must NOT
  // hardcode scope='worker' — supervisor-only spirits would never see
  // the granted tool. Defaulting to 'both' makes the grant work
  // regardless of which spirit role runs.
  it('grantToolToAgent: auto-attaches with scope="both" when no attachment exists', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'scope-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 't', description: '' }],
      fetchedAt: new Date().toISOString(),
    });

    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 't',
    });

    const mcpAttachments = fixture.repo
      .listAgentMcpAttachments(fixture.organizationId, 'agent-x')
      .filter((a) => a.mcpServerId === server.id);
    expect(mcpAttachments).toHaveLength(1);
    expect(mcpAttachments[0]!.scope).toBe('both');

    const toolGrants = fixture.repo.listAgentToolAttachments(
      fixture.organizationId,
      'agent-x',
      server.id,
    );
    expect(toolGrants).toHaveLength(1);
    expect(toolGrants[0]!.scope).toBe('both');

    // Both spirit roles can resolve the server through the runtime
    // lookup, so the grant is reachable from either spawn path.
    expect(
      fixture.repo.listAttachedServersForSpirit(
        fixture.organizationId,
        'agent-x',
        'worker',
      ),
    ).toHaveLength(1);
    expect(
      fixture.repo.listAttachedServersForSpirit(
        fixture.organizationId,
        'agent-x',
        'supervisor',
      ),
    ).toHaveLength(1);
  });

  // Regression: low-confidence inferred tools must carry the
  // needsReview flag through the catalog so the review queue
  // surfaces them before re-test. Pre-fix only inf.risk was threaded
  // through; needsReview defaulted to false because
  // resolveClassification returns source='inferred' when an inferred
  // fallback is supplied (not 'unknown'), so the heuristic flag was
  // silently dropped.
  it('getCatalog: surfaces needsReview from the inferred fallback when no stored row exists', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'review-mcp',
      transport: 'stdio',
      command: 'x',
    });
    // `frobnicate_widget` has no verb in any set + no helpful
    // description → classifier returns low confidence with
    // needsReview=true. Pinned by classify-tool.test.ts.
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [
        { name: 'get_thing', description: 'reads it' },
        { name: 'frobnicate_widget', description: '' },
      ],
      fetchedAt: new Date().toISOString(),
    });

    const catalog = fixture.registry.getCatalog(fixture.organizationId);
    const row = catalog.servers.find((s) => s.id === server.id)!;
    const obvious = row.tools.find((t) => t.name === 'get_thing')!;
    const lowConfidence = row.tools.find((t) => t.name === 'frobnicate_widget')!;

    expect(obvious.needsReview).toBe(false);
    expect(lowConfidence.needsReview).toBe(true);
    // And the source still resolves to 'inferred' (not 'unknown') —
    // the fix decouples needsReview from the source field entirely.
    expect(lowConfidence.source).toBe('inferred');
  });

  // Regression: resetToolClassification used to delete the manual
  // row first and only check whether the tool descriptor existed
  // afterwards. A stale cache (tool removed, listTools out of date)
  // would silently wipe the admin override and then bail with a
  // missing-descriptor null return — operator intended to reset, got
  // a hard delete.
  it('resetToolClassification: rejects unknown tool name without erasing the manual row', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'stale-mcp',
      transport: 'stdio',
      command: 'x',
    });
    // Cache has only `real_tool` — admin classifies a PHANTOM that
    // somehow already has a row (e.g. via a prior write before tool
    // was removed from the server).
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'real_tool', description: '' }],
      fetchedAt: new Date().toISOString(),
    });
    fixture.repo.upsertMcpToolClassification({
      organizationId: fixture.organizationId,
      mcpServerId: server.id,
      toolName: 'ghost_tool',
      risk: 'destructive',
      source: 'manual',
      needsReview: false,
      updatedAt: new Date().toISOString(),
      updatedBy: 'admin',
    });

    expect(() =>
      fixture.registry.resetToolClassification(
        fixture.organizationId,
        server.id,
        'ghost_tool',
      ),
    ).toThrow(/Tool not found/);

    // The manual row survives — reset failed cleanly without
    // mutating state.
    const after = fixture.repo.getMcpToolClassification(
      fixture.organizationId,
      server.id,
      'ghost_tool',
    );
    expect(after).not.toBeNull();
    expect(after?.risk).toBe('destructive');
    expect(after?.source).toBe('manual');
  });

  it('resetToolClassification: replaces a manual row with the inferred classification for a live tool', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'reset-happy-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'get_thing', description: 'reads' }],
      fetchedAt: new Date().toISOString(),
    });
    fixture.registry.setToolClassification({
      organizationId: fixture.organizationId,
      serverId: server.id,
      toolName: 'get_thing',
      risk: 'destructive',
      updatedBy: 'admin',
    });

    const row = fixture.registry.resetToolClassification(
      fixture.organizationId,
      server.id,
      'get_thing',
    );
    expect(row.risk).toBe('read');
    expect(row.source).toBe('inferred');
  });

  // Regression: detach() used to leave per-tool grants behind, so
  // re-attaching the same MCP would silently restore the agent into
  // allowlist mode with whatever tools were granted before — none
  // of which the operator explicitly re-authorised.
  it('detach: cascades agent_tool_attachments so re-attaching does not restore stale grants', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'cascade-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [
        { name: 'tool_a', description: '' },
        { name: 'tool_b', description: '' },
      ],
      fetchedAt: new Date().toISOString(),
    });

    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 'tool_a',
    });
    expect(
      fixture.repo.listAgentToolAttachments(fixture.organizationId, 'agent-x', server.id),
    ).toHaveLength(1);

    fixture.registry.detach(fixture.organizationId, 'agent-x', server.id);

    // Both attachment tables are clean.
    expect(
      fixture.repo
        .listAgentMcpAttachments(fixture.organizationId, 'agent-x')
        .filter((a) => a.mcpServerId === server.id),
    ).toHaveLength(0);
    expect(
      fixture.repo.listAgentToolAttachments(fixture.organizationId, 'agent-x', server.id),
    ).toHaveLength(0);

    // Re-attach the server: catalog must NOT show this agent in
    // allowlist mode (no per-tool rows survived the detach).
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'worker',
    });
    const catalog = fixture.registry.getCatalog(fixture.organizationId);
    const row = catalog.servers.find((s) => s.id === server.id)!;
    expect(row.allowlistAgents).not.toContain('agent-x');
  });

  // Regression: the test() pipeline used to drop the server-declared
  // destructive metadata at the descriptor boundary, so an MCP that
  // explicitly marks a tool destructive would always get reclassified
  // by the verb heuristic instead.
  it('test() carries server-declared destructive metadata into descriptors + classification', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    // Inject a fake live connection that surfaces a tool whose name
    // has no destructive verb but is marked `destructive=true` by
    // the server's annotations. Pre-fix this hint was discarded; the
    // classifier would then call this `write` based on `update_thing`.
    const fakeConnect = async (): Promise<MCPConnection> =>
      ({
        listTools: async () => [
          {
            name: 'update_thing',
            description: 'updates a thing',
            inputSchema: {},
            destructive: true,
          },
        ],
        callTool: async () => ({ content: 'ok' }),
        close: async () => undefined,
      }) as unknown as MCPConnection;

    const registry = new McpRegistryService(fixture.repo, fakeConnect);
    const server = registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'destructive-meta-mcp',
      transport: 'stdio',
      command: 'x',
    });

    const result = await registry.test(fixture.organizationId, server.id);
    expect(result.ok).toBe(true);
    expect(result.tools[0]?.destructive).toBe(true);

    const stored = fixture.repo.getMcpToolClassification(
      fixture.organizationId,
      server.id,
      'update_thing',
    );
    expect(stored?.risk).toBe('destructive');
  });

  // High (bot): per-tool grants store a role scope, but the runtime
  // filter and the catalog used to ignore it. A worker-only grant
  // would flip the supervisor view into allowlist mode (and vice
  // versa), so tools could disappear from the intended role or be
  // exposed to the wrong one.
  it('getCatalog(?role=): only counts grants whose scope matches the role for allowlistAgents', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'scope-aware-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [
        { name: 'tool_a', description: '' },
        { name: 'tool_b', description: '' },
      ],
      fetchedAt: new Date().toISOString(),
    });

    // Attach as 'both' so the agent is reachable for either role.
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'both',
    });

    // Then narrow the per-tool grant to worker-only.
    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 'tool_a',
      scope: 'worker',
    });

    // Role-agnostic view: the agent IS in allowlist mode somewhere.
    const anyRole = fixture.registry.getCatalog(fixture.organizationId);
    expect(
      anyRole.servers.find((s) => s.id === server.id)?.allowlistAgents,
    ).toContain('agent-x');

    // Supervisor view: no matching scope → not in allowlist mode →
    // all tools exposed instead of an empty palette.
    const supervisor = fixture.registry.getCatalog(
      fixture.organizationId,
      'agent-x',
      'supervisor',
    );
    const supRow = supervisor.servers.find((s) => s.id === server.id)!;
    expect(supRow.allowlistAgents).not.toContain('agent-x');
    expect(
      supervisor.agentView![`${server.id}::tool_a`]?.exposed,
    ).toBe(true);
    expect(
      supervisor.agentView![`${server.id}::tool_a`]?.exposureReason,
    ).toBe('all-tools-mode');

    // Worker view: matching scope → allowlist mode → only tool_a.
    const worker = fixture.registry.getCatalog(
      fixture.organizationId,
      'agent-x',
      'worker',
    );
    expect(
      worker.servers.find((s) => s.id === server.id)?.allowlistAgents,
    ).toContain('agent-x');
    expect(worker.agentView![`${server.id}::tool_a`]?.exposed).toBe(true);
    expect(worker.agentView![`${server.id}::tool_a`]?.exposureReason).toBe(
      'granted',
    );
    expect(worker.agentView![`${server.id}::tool_b`]?.exposed).toBe(false);
    expect(worker.agentView![`${server.id}::tool_b`]?.exposureReason).toBe(
      'no-tool-grant',
    );
  });

  // Regression: the role filter previously only applied to per-tool
  // grants, not to the MCP attachment used for `hasMcp`. A
  // supervisor-only MCP attachment would still make the worker
  // catalog view report `exposed: true` for every tool on the
  // server, overstating what the runtime actually exposes.
  it('getCatalog(?role=): supervisor-only MCP attachment is invisible to the worker view', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'role-attach-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 'tool_a', description: '' }],
      fetchedAt: new Date().toISOString(),
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'supervisor',
    });

    // Supervisor view: attachment matches the role → exposed.
    const sup = fixture.registry.getCatalog(
      fixture.organizationId,
      'agent-x',
      'supervisor',
    );
    expect(sup.agentView![`${server.id}::tool_a`]?.exposed).toBe(true);
    expect(sup.agentView![`${server.id}::tool_a`]?.exposureReason).toBe(
      'all-tools-mode',
    );

    // Worker view: attachment scope doesn't match → not reachable.
    // Pre-fix `hasMcp` was true and the catalog reported `exposed: true`
    // anyway, overstating what the runtime ever sees.
    const wkr = fixture.registry.getCatalog(
      fixture.organizationId,
      'agent-x',
      'worker',
    );
    expect(wkr.agentView![`${server.id}::tool_a`]?.exposed).toBe(false);
    expect(wkr.agentView![`${server.id}::tool_a`]?.exposureReason).toBe(
      'no-mcp-attachment',
    );
  });

  // Companion: when an MCP attachment already exists, the per-tool
  // grant must mirror its scope rather than overwriting it or
  // defaulting elsewhere. Avoids silently widening or narrowing what
  // the operator already authorised.
  it('grantToolToAgent: mirrors existing attachment scope on the grant row', async () => {
    const fixture = await createFixture();
    tempDirs.push(fixture.archiveRoot);

    const server = fixture.registry.create({
      organizationId: fixture.organizationId,
      createdBy: fixture.ownerId,
      name: 'mirror-mcp',
      transport: 'stdio',
      command: 'x',
    });
    fixture.repo.saveMcpToolCache({
      mcpServerId: server.id,
      organizationId: fixture.organizationId,
      tools: [{ name: 't', description: '' }],
      fetchedAt: new Date().toISOString(),
    });
    fixture.registry.attach({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      scope: 'supervisor',
    });

    fixture.registry.grantToolToAgent({
      organizationId: fixture.organizationId,
      memberId: 'agent-x',
      mcpServerId: server.id,
      toolName: 't',
    });

    const toolGrants = fixture.repo.listAgentToolAttachments(
      fixture.organizationId,
      'agent-x',
      server.id,
    );
    expect(toolGrants).toHaveLength(1);
    expect(toolGrants[0]!.scope).toBe('supervisor');

    // The existing MCP attachment scope is preserved.
    const mcpAttachments = fixture.repo
      .listAgentMcpAttachments(fixture.organizationId, 'agent-x')
      .filter((a) => a.mcpServerId === server.id);
    expect(mcpAttachments).toHaveLength(1);
    expect(mcpAttachments[0]!.scope).toBe('supervisor');
  });
});

// =====================================================================
// Audit fix — route error mapping. The route handler had a default
// branch that surfaced every unknown error as `400 ERR_BAD_REQUEST`,
// hiding real server faults (DB outage, secret-store I/O, MCP
// transport blip) from monitoring/retry tooling. The mapping now
// uses an explicit 400 allowlist and falls back to 500.
// =====================================================================

describe('mapMcpRouteError', () => {
  it('maps "X not found" errors → 404 ERR_NOT_FOUND', () => {
    expect(mapMcpRouteError(new Error('Organization not found: org-x'))).toEqual({
      status: 404,
      code: 'ERR_NOT_FOUND',
      message: 'Organization not found: org-x',
    });
    expect(mapMcpRouteError(new Error('MCP server not found: s-1'))).toEqual({
      status: 404,
      code: 'ERR_NOT_FOUND',
      message: 'MCP server not found: s-1',
    });
    expect(mapMcpRouteError(new Error('Member not found: agent-x'))).toEqual({
      status: 404,
      code: 'ERR_NOT_FOUND',
      message: 'Member not found: agent-x',
    });
    expect(
      mapMcpRouteError(new Error('Tool not found: "phantom" on MCP server "fs"')),
    ).toEqual({
      status: 404,
      code: 'ERR_NOT_FOUND',
      message: 'Tool not found: "phantom" on MCP server "fs"',
    });
  });

  it('maps state-conflict messages → 409 ERR_CONFLICT', () => {
    for (const msg of [
      'MCP server "fs" already exists in this organisation',
      'MCP server "fs" is disabled',
      'Cannot attach MCP to retired member "agent-x"',
      'Cannot attach MCP to non-agent member "owner"',
    ]) {
      const result = mapMcpRouteError(new Error(msg));
      expect(result.status).toBe(409);
      expect(result.code).toBe('ERR_CONFLICT');
    }
  });

  it('maps explicit input-validation messages → 400 ERR_BAD_REQUEST', () => {
    for (const msg of [
      'MCP server name is required',
      'stdio MCP servers require a command',
      'sse MCP servers require a url',
      'http-streamable MCP servers require a url',
      'Failed to parse MCP config JSON: Unexpected token',
    ]) {
      const result = mapMcpRouteError(new Error(msg));
      expect(result.status).toBe(400);
      expect(result.code).toBe('ERR_BAD_REQUEST');
    }
  });

  it('maps unknown / unexpected errors → 500 ERR_INTERNAL (NOT 400)', () => {
    // The audit case: a DB I/O failure, a secret-store write failure,
    // an MCP transport error — none match the 404/409/400 buckets and
    // pre-fix were silently routed to ERR_BAD_REQUEST (400). The
    // catch-all is now 500.
    const cases = [
      'SQLITE_BUSY: database is locked',
      'EACCES: permission denied, write /var/folders/.../secret',
      'connect ECONNREFUSED 127.0.0.1:53000',
      'Unexpected error inside repo.transaction()',
    ];
    for (const msg of cases) {
      const result = mapMcpRouteError(new Error(msg));
      expect(result.status).toBe(500);
      expect(result.code).toBe('ERR_INTERNAL');
      expect(result.message).toBe(msg);
    }

    // Non-Error throws are also handled.
    const stringResult = mapMcpRouteError('boom');
    expect(stringResult.status).toBe(500);
    expect(stringResult.code).toBe('ERR_INTERNAL');
    expect(stringResult.message).toBe('boom');
  });
});
