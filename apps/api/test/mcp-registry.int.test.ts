import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  McpRegistryService,
  OnboardingService,
  createTeamStore,
} from '@ujima/orchestrator';

// Phase 3 of the MCP integration — covers the registry CRUD + JSON
// import path + per-agent attachments + the redaction contract that
// keeps env/header secrets off the API surface. Connection-test +
// runtime spirit integration paths live in `spirits.int.test.ts`
// (or are exercised lazily through the spirit MCP path).

async function createFixture() {
  const archiveRoot = await mkdtemp(join(tmpdir(), 'ujima-mcp-registry-'));
  const repo = new Repository(openDatabase({ dbPath: ':memory:' }));
  const teamStore = createTeamStore();
  const onboarding = new OnboardingService(repo, teamStore);
  const result = await onboarding.onboard({
    organizationName: 'MCP Org',
    ownerName: 'Owner',
    ownerEmail: 'owner@example.com',
    ownerPassword: 'correct horse battery staple',
    workspaceRoot: archiveRoot,
    providerKeys: {},
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
  const owner = result.members.find((m) => m.kind === 'human');
  if (!owner) throw new Error('owner missing');
  const registry = new McpRegistryService(repo);
  return {
    archiveRoot,
    repo,
    registry,
    organizationId: result.organization.id,
    ownerId: owner.id,
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
});
