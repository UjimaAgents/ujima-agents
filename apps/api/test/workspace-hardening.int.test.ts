import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { loadAgentTeam } from '@ujima/framework';
import {
  ConversationService,
  OnboardingService,
  ToolServiceImpl,
  createApiServices,
  createTeamStore,
  type PermissionContextBuilder,
} from '@ujima/orchestrator';
import { Repository, createBufferLogger, createRuntimeHost, type RuntimeHost } from '@ujima/runtime-core';
import { MemberSchema, OrganizationSchema, type AgentDef, type MCPDef, type TeamDef } from '@ujima/shared';
import type { LLMProvider } from '@ujima/llm/legacy';
import { createTransport, type Transport } from '../src/transport/server';

const TOKEN = 'b'.repeat(64);

function stubProvider(): LLMProvider {
  throw new Error('no provider configured');
}

function createNoopRealtime() {
  return {
    emit: () => undefined,
  };
}

function createScopedTeam(workspaceRoot: string) {
  return loadAgentTeam({
    name: 'Workspace Hardening Org',
    workspace: { root: workspaceRoot },
    providers: {
      openai: {
        kind: 'openai',
        defaultModel: 'gpt-5.4',
        models: ['gpt-5.4'],
      },
    },
    roles: [
      {
        name: 'frontend-engineer',
        title: 'Frontend Engineer',
        instructions: 'Work in the frontend only.',
        provider: 'openai',
        model: 'gpt-5.4',
        workspaceScopes: ['apps/web'],
        tools: ['filesystem', 'shell'],
        channels: ['general'],
      },
      {
        name: 'owner',
        title: 'Owner',
        instructions: 'Own the org.',
        workspaceScopes: ['.'],
        tools: ['filesystem'],
        channels: ['general'],
      },
    ],
    agents: [{ name: 'frontend-alice', roleName: 'frontend-engineer', personalityName: 'direct' }],
    channels: [{ name: 'general', kind: 'general', topic: 'General' }],
  } as Record<string, unknown>);
}

describe('workspace-root REST gating', () => {
  let homeDir: string;
  let host: RuntimeHost;
  let transport: Transport;
  let repo: Repository;
  let baseUrl: string;
  let organizationId: string;

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-workspace-gate-'));
    host = await createRuntimeHost(
      {
        homeDir,
        logger: createBufferLogger(),
        loadAgent: async () => undefined as AgentDef | undefined,
        loadTeam: async () => undefined as TeamDef | undefined,
        resolveMCPDef: async (_workspaceId, id) => {
          throw new Error(`no mcp ${id}`);
        },
        getProvider: stubProvider,
      },
      {},
    );

    repo = new Repository(host.db.raw);
    const teamStore = createTeamStore();
    const missingRoot = join(homeDir, 'missing-root');
    const team = createScopedTeam(missingRoot);
    teamStore.setTeam(team);

    organizationId = 'org-workspace-gate';
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: organizationId,
        name: 'Workspace Gate Org',
        workspace: { root: missingRoot, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'owner-1',
        organizationId,
        name: 'Owner',
        kind: 'human',
        roleName: 'owner',
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'frontend-alice',
        organizationId,
        name: 'frontend-alice',
        kind: 'agent',
        roleName: 'frontend-engineer',
      }),
    );
    repo.saveApproval({
      id: 'approval-1',
      organizationId,
      runId: 'run-1',
      requestedBy: 'owner-1',
      resourceType: 'file',
      resourcePath: 'apps/web/index.ts',
      action: 'write',
      status: 'pending',
      reason: 'pending',
      createdAt: new Date().toISOString(),
    });

    const buildPermissionContext: PermissionContextBuilder = (input) => {
      const teamConfig = teamStore.getTeam();
      const member = repo.getMember(input.organizationId, input.memberId);
      const role = teamConfig && member ? teamConfig.getRole(member.roleName) : undefined;
      const agentConfig = teamConfig
        ? (teamConfig.getAgent(input.memberId) ??
          (member ? teamConfig.getAgent(member.name) : undefined))
        : undefined;

      return {
        agent: {
          id: input.memberId,
          name: agentConfig?.name ?? input.memberId,
          persona: agentConfig?.personalityName ?? '',
          model: role?.model ?? '',
          mcp: input.toolId,
          permissions: {
            allowed_tools: role?.tools ?? [],
            blocked_tools: [],
            rate_limit: { calls_per_minute: 30, max_session_tokens: 100_000 },
          },
          communication: { publishes: [], subscribes: [] },
          escalation: { conditions: [], escalate_to: 'human' },
        },
        mcp: { id: input.toolId },
        toolName: input.toolId,
        args: input.input,
        taskId: input.runId,
        sessionId: input.runId,
      };
    };

    transport = createTransport({
      host,
      token: TOKEN,
      logger: createBufferLogger(),
      bindHost: '127.0.0.1',
      port: 0,
      apiServices: {
        repo,
        buildServices: (realtime) =>
          createApiServices({
            teamStore,
            repo,
            realtime,
            permissions: host.permissions,
            buildPermissionContext,
          }),
      },
    });
    await transport.listen();
    baseUrl = transport.url;
  }, 15_000);

  afterAll(async () => {
    await transport.close();
    await host.shutdown({ drainMs: 500 });
    await rm(homeDir, { recursive: true, force: true });
  });

  it('returns 409 ERR_NO_WORKSPACE_ROOT for org mutation routes before the workspace root exists', async () => {
    const checks = [
      {
        url: `${baseUrl}/api/messages`,
        method: 'POST',
        body: {
          organizationId,
          threadId: 'thread-1',
          senderId: 'owner-1',
          content: 'hello',
        },
      },
      {
        url: `${baseUrl}/api/runs`,
        method: 'POST',
        body: {
          organizationId,
          agentId: 'frontend-alice',
          threadId: 'thread-1',
        },
      },
      {
        url: `${baseUrl}/api/tasks/promote`,
        method: 'POST',
        body: {
          organizationId,
          channelId: 'general',
          requestedBy: 'owner-1',
          prompt: 'Please handle this',
        },
      },
      {
        url: `${baseUrl}/api/orgs/${organizationId}/members`,
        method: 'POST',
        body: {
          name: 'Reviewer',
          kind: 'agent',
          roleName: 'frontend-engineer',
        },
      },
      {
        url: `${baseUrl}/api/settings/providers`,
        method: 'POST',
        body: {
          organizationId,
          providerKeys: {},
        },
      },
      {
        url: `${baseUrl}/api/settings/providers/openai?organizationId=${organizationId}`,
        method: 'DELETE',
      },
      {
        url: `${baseUrl}/api/settings/organization`,
        method: 'PATCH',
        body: {
          organizationId,
          organizationName: 'Renamed',
        },
      },
      {
        url: `${baseUrl}/api/approvals/approval-1/resolve`,
        method: 'POST',
        body: {
          organizationId,
          status: 'approved',
        },
      },
    ];

    for (const check of checks) {
      const response = await fetch(check.url, {
        method: check.method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          ...(check.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(check.body ? { body: JSON.stringify(check.body) } : {}),
      });
      const payload = (await response.json()) as { code: string; message: string };
      expect(response.status, `${check.method} ${check.url}`).toBe(409);
      expect(payload.code, `${check.method} ${check.url}`).toBe('ERR_NO_WORKSPACE_ROOT');
    }
  });
});

describe('workspace path hardening', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function createToolFixture() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'ujima-workspace-hardening-'));
    tempDirs.push(workspaceRoot);
    await mkdir(join(workspaceRoot, 'apps', 'web'), { recursive: true });
    await mkdir(join(workspaceRoot, 'apps', 'api'), { recursive: true });
    await writeFile(join(workspaceRoot, 'apps', 'web', 'index.ts'), 'export const ok = true;\n', 'utf8');
    await writeFile(join(workspaceRoot, 'apps', 'api', 'server.ts'), 'export const api = true;\n', 'utf8');

    const db = openDatabase({ dbPath: ':memory:' });
    const repo = new Repository(db);
    const teamStore = createTeamStore();
    const onboarding = new OnboardingService(repo, teamStore);
    const realtime = createNoopRealtime();
    const conversations = new ConversationService(repo, realtime);
    const tools = new ToolServiceImpl(
      teamStore,
      repo,
      { requestApproval: () => ({ id: 'approval-1' }) },
      conversations,
      realtime,
    );

    const result = await onboarding.onboard({
      organizationName: 'Workspace Hardening Org',
      ownerName: 'Owner',
      workspaceRoot,
      providerKeys: {},
      team: {
        name: 'Workspace Hardening Org',
        roles: [
          {
            name: 'frontend-engineer',
            title: 'Frontend Engineer',
            instructions: 'Stay in apps/web.',
            workspaceScopes: ['apps/web'],
            tools: ['filesystem', 'shell'],
            channels: ['general'],
          },
        ],
        agents: [
          {
            name: 'frontend-alice',
            roleName: 'frontend-engineer',
            personalityName: 'direct',
          },
        ],
        channels: [{ name: 'general', kind: 'general', topic: 'General' }],
      },
    });

    return { workspaceRoot, repo, tools, db, organizationId: result.organization.id };
  }

  it('rejects shell traversal attempts that escape the workspace root', async () => {
    const fixture = await createToolFixture();

    await expect(
      fixture.tools.invoke({
        organizationId: fixture.organizationId,
        runId: 'run-traversal',
        memberId: 'frontend-alice',
        toolCallId: 'tc-traversal',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: {
          command: 'cat',
          args: ['../../etc/passwd'],
        },
      }),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });
  });

  it('rejects filesystem access outside the member role scope', async () => {
    const fixture = await createToolFixture();

    await expect(
      fixture.tools.invoke({
        organizationId: fixture.organizationId,
        runId: 'run-scope',
        memberId: 'frontend-alice',
        toolCallId: 'tc-scope',
        toolId: 'filesystem',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'apps/api/server.ts',
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });
  });

  it('rejects symlink escapes that point outside the workspace root', async () => {
    const fixture = await createToolFixture();
    const outsideDir = await mkdtemp(join(tmpdir(), 'ujima-workspace-outside-'));
    tempDirs.push(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'outside\n', 'utf8');
    await symlink(outsideDir, join(fixture.workspaceRoot, 'apps', 'web', 'outside-link'));

    await expect(
      fixture.tools.invoke({
        organizationId: fixture.organizationId,
        runId: 'run-symlink',
        memberId: 'frontend-alice',
        toolCallId: 'tc-symlink',
        toolId: 'filesystem',
        action: 'read',
        resourceType: 'file',
        resourcePath: 'apps/web/outside-link/secret.txt',
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });
  });

  it('rejects shell cwd values that escape the member role scope', async () => {
    const fixture = await createToolFixture();

    fixture.tools.allowRun(fixture.organizationId, 'run-cwd');

    await expect(
      fixture.tools.invoke({
        organizationId: fixture.organizationId,
        runId: 'run-cwd',
        memberId: 'frontend-alice',
        toolCallId: 'tc-cwd',
        toolId: 'shell',
        action: 'execute',
        resourceType: 'shell',
        input: {
          command: 'pwd',
          args: [],
          cwd: 'apps/api',
        },
      }),
    ).rejects.toMatchObject({ code: 'ERR_PATH_ESCAPE' });
  });

  it('allows shell -c command strings without treating them as filesystem paths', async () => {
    const fixture = await createToolFixture();

    fixture.tools.allowRun(fixture.organizationId, 'run-shell-c');

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-shell-c',
      memberId: 'frontend-alice',
      toolCallId: 'tc-shell-c',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      input: {
        command: 'sh',
        args: ['-c', 'printf ok'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      status: 'completed',
      result: { stdout: 'ok' },
    });
  });

  it('does not rewrite ordinary slash-containing shell args as filesystem paths', async () => {
    const fixture = await createToolFixture();

    fixture.tools.allowRun(fixture.organizationId, 'run-shell-slash-arg');

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-shell-slash-arg',
      memberId: 'frontend-alice',
      toolCallId: 'tc-shell-slash-arg',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      input: {
        command: 'sh',
        args: ['-c', 'printf "%s" "$1"', '_', 'feature/foo'],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      status: 'completed',
      result: { stdout: 'feature/foo' },
    });
  });

  it('resolves positional file operands for file-oriented shell commands relative to cwd', async () => {
    const fixture = await createToolFixture();

    fixture.tools.allowRun(fixture.organizationId, 'run-shell-relative-file');

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-shell-relative-file',
      memberId: 'frontend-alice',
      toolCallId: 'tc-shell-relative-file',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      input: {
        command: 'cat',
        args: ['index.ts'],
        cwd: 'apps/web',
      },
    });

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      status: 'completed',
      result: { stdout: 'export const ok = true;\n' },
    });
  });

  it('preserves the requested leaf path when writing a new file', async () => {
    const fixture = await createToolFixture();

    fixture.tools.allowRun(fixture.organizationId, 'run-new-file');

    const writeResult = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-new-file',
      memberId: 'frontend-alice',
      toolCallId: 'tc-new-file',
      toolId: 'filesystem',
      action: 'write',
      resourceType: 'file',
      resourcePath: 'apps/web/new-file.ts',
      input: {
        content: 'export const created = true;\n',
      },
    });

    expect(writeResult.ok).toBe(true);
    expect(await readFile(join(fixture.workspaceRoot, 'apps', 'web', 'new-file.ts'), 'utf8')).toBe(
      'export const created = true;\n',
    );
  });

  it('backfills workspace_members scope rows for existing members on first resolver use', async () => {
    const fixture = await createToolFixture();
    fixture.db
      .prepare('DELETE FROM workspace_members WHERE organization_id = ? AND member_id = ?')
      .run(fixture.organizationId, 'frontend-alice');

    await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-backfill',
      memberId: 'frontend-alice',
      toolCallId: 'tc-backfill',
      toolId: 'filesystem',
      action: 'read',
      resourceType: 'file',
      resourcePath: 'apps/web/index.ts',
      input: {},
    });

    expect(fixture.repo.getWorkspaceMember(fixture.organizationId, 'frontend-alice')?.roleScopePaths).toEqual([
      join(fixture.workspaceRoot, 'apps', 'web'),
    ]);
  });
});
