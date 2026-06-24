import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { loadAgentTeam } from '@ujima/framework';
import {
  ALWAYS_AVAILABLE_AGENT_TOOLS,
  ApprovedRunScopeTracker,
  ConversationService,
  AuthService,
  GoalSystemService,
  OnboardingService,
  ToolServiceImpl,
  createApiServices,
  createTeamStore,
  type PermissionContextBuilder,
} from '@ujima/orchestrator';
import { Repository, createBufferLogger, createRuntimeHost, type RuntimeHost } from '@ujima/runtime-core';
import { MemberSchema, OrganizationSchema, type AgentDef, type MCPDef, type TeamDef } from '@ujima/shared';
import type { LanguageModel } from 'ai';
import { createTransport, type Transport } from '../src/transport/server';

/** POSIX-only assumptions (`sh`, `cat`) or symlink privileges differ on Windows. */
const skipIfWin32 = process.platform === 'win32';

const TOKEN = 'b'.repeat(64);
const stubLanguageModel = {} as unknown as LanguageModel;

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
  let readyOrganizationId: string;
  let readyOwnerSessionToken: string;
  let otherOwnerSessionToken: string;

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
        getModel: () => stubLanguageModel,
      },
      {},
    );

    repo = new Repository(host.db.raw);
    const teamStore = createTeamStore();
    const missingRoot = join(homeDir, 'missing-root');
    const team = createScopedTeam(missingRoot);

    organizationId = 'org-workspace-gate';
    teamStore.setTeam(team, organizationId);
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

    readyOrganizationId = 'org-ready-authz';
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: readyOrganizationId,
        name: 'Ready Authz Org',
        workspace: { root: homeDir, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'ready-owner',
        organizationId: readyOrganizationId,
        name: 'Ready Owner',
        kind: 'human',
        roleName: 'owner',
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'ready-agent',
        organizationId: readyOrganizationId,
        name: 'ready-agent',
        kind: 'agent',
        roleName: 'frontend-engineer',
        llm: 'openai',
        model: 'gpt-5.4',
      }),
    );
    repo.saveApproval({
      id: 'ready-approval-1',
      organizationId: readyOrganizationId,
      runId: 'ready-run-1',
      requestedBy: 'ready-agent',
      resourceType: 'file',
      resourcePath: 'apps/web/index.ts',
      action: 'write',
      status: 'pending',
      reason: 'pending',
      createdAt: new Date().toISOString(),
    });

    const otherOrganizationId = 'org-other-authz';
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: otherOrganizationId,
        name: 'Other Authz Org',
        workspace: { root: homeDir, roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: 'other-owner',
        organizationId: otherOrganizationId,
        name: 'Other Owner',
        kind: 'human',
        roleName: 'owner',
      }),
    );

    const auth = new AuthService(repo);
    readyOwnerSessionToken = auth.registerOwnerAccount({
      organizationId: readyOrganizationId,
      memberId: 'ready-owner',
      email: 'ready-owner@example.com',
      password: 'password',
    }).sessionToken;
    otherOwnerSessionToken = auth.registerOwnerAccount({
      organizationId: otherOrganizationId,
      memberId: 'other-owner',
      email: 'other-owner@example.com',
      password: 'password',
    }).sessionToken;

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
          mcp: input.permissionMcpId ?? input.toolId,
          permissions: {
            allowed_tools: [...new Set([...(role?.tools ?? []), ...ALWAYS_AVAILABLE_AGENT_TOOLS])],
            blocked_tools: [],
            rate_limit: { max_session_tokens: 100_000 },
          },
          communication: { publishes: [], subscribes: [] },
          escalation: { conditions: [], escalate_to: 'human' },
        },
        mcp: { id: input.permissionMcpId ?? input.toolId },
        toolName: input.permissionToolName ?? input.toolId,
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
            workspaces: host.workspaces,
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
          resolution: 'allow_once',
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

  it('requires a session for privileged mutations on ready workspaces', async () => {
    const approvalResponse = await fetch(`${baseUrl}/api/approvals/ready-approval-1/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        resolution: 'reject',
      }),
    });
    expect(approvalResponse.status).toBe(401);

    const memberResponse = await fetch(`${baseUrl}/api/orgs/${readyOrganizationId}/members/ready-agent`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(memberUpdateBody()),
    });
    expect(memberResponse.status).toBe(401);
  });

  it('rejects privileged mutations from another organization session', async () => {
    const approvalResponse = await fetch(`${baseUrl}/api/approvals/ready-approval-1/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': otherOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        resolution: 'reject',
      }),
    });
    expect(approvalResponse.status).toBe(403);

    const memberResponse = await fetch(`${baseUrl}/api/orgs/${readyOrganizationId}/members/ready-agent`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': otherOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(memberUpdateBody()),
    });
    expect(memberResponse.status).toBe(403);
  });

  it('allows privileged mutations from the matching organization session', async () => {
    const approvalResponse = await fetch(`${baseUrl}/api/approvals/ready-approval-1/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        resolution: 'reject',
      }),
    });
    expect(approvalResponse.status).toBe(200);

    const memberResponse = await fetch(`${baseUrl}/api/orgs/${readyOrganizationId}/members/ready-agent`, {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify(memberUpdateBody({ name: 'ready-agent-renamed' })),
    });
    expect(memberResponse.status).toBe(200);
    expect(await memberResponse.json()).toMatchObject({
      id: 'ready-agent',
      name: 'ready-agent-renamed',
    });
  });

  // Regression: the dedupe/access fast-path ran requireThreadAccess
  // BEFORE sendDirectMessage → sendSelfNote got a chance to lazily
  // create `self:<senderId>`. For a first-ever self-message with
  // clientMessageId set, the access check threw `Thread not found`
  // and the message never posted. The route now skips the access
  // check for `recipientId === 'self'` (self channels are
  // sender-owned by construction; sendSelfNote materialises the
  // channel and thread on demand).
  it('accepts a first-ever self direct message that carries a clientMessageId', async () => {
    // Pre-condition: the owner's self channel does NOT exist yet.
    expect(repo.getChannel(readyOrganizationId, 'self:ready-owner')).toBeNull();
    expect(repo.getThread(readyOrganizationId, 'self:ready-owner')).toBeNull();

    const response = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        senderId: 'ready-owner',
        recipientId: 'self',
        content: 'first self note via idempotency path',
        clientMessageId: 'self-note-first-send',
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; threadId: string; content: string };
    expect(body.threadId).toBe('self:ready-owner');
    expect(body.content).toBe('first self note via idempotency path');

    // sendSelfNote should have materialised both rows on the way through.
    expect(repo.getChannel(readyOrganizationId, 'self:ready-owner')).not.toBeNull();
    expect(repo.getThread(readyOrganizationId, 'self:ready-owner')).not.toBeNull();

    // Retrying with the same clientMessageId returns the same message
    // (dedupe still works — the access bypass didn't break it).
    const retry = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        senderId: 'ready-owner',
        recipientId: 'self',
        content: 'first self note via idempotency path',
        clientMessageId: 'self-note-first-send',
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { id: string };
    expect(retryBody.id).toBe(body.id);
  });

  // Regression: the same dedupe/access fast-path also broke first-
  // ever peer-to-peer DMs. The synthetic `dm:a:b` thread id is lazily
  // provisioned inside `sendDirectMessage` on the first call — so
  // pre-fix, `requireThreadAccess` threw `Thread not found` before
  // the thread (or channel) existed. The route now skips the access
  // preflight when neither the thread nor its backing channel exist
  // yet (no cached message can exist on a thread that doesn't exist).
  it('accepts a first-ever peer-to-peer direct message that carries a clientMessageId', async () => {
    const dmThreadId = 'dm:ready-agent:ready-owner';
    // Pre-condition: the DM channel/thread does NOT exist yet.
    expect(repo.getChannel(readyOrganizationId, dmThreadId)).toBeNull();
    expect(repo.getThread(readyOrganizationId, dmThreadId)).toBeNull();

    const response = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        senderId: 'ready-owner',
        recipientId: 'ready-agent',
        content: 'first ever dm via idempotency path',
        clientMessageId: 'dm-first-send',
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { id: string; threadId: string; content: string };
    expect(body.threadId).toBe(dmThreadId);
    expect(body.content).toBe('first ever dm via idempotency path');

    // sendDirectMessage should have materialised both rows on the way through.
    expect(repo.getChannel(readyOrganizationId, dmThreadId)).not.toBeNull();
    expect(repo.getThread(readyOrganizationId, dmThreadId)).not.toBeNull();

    // Retry with the same clientMessageId dedupes (and now the
    // preflight access check DOES run because the thread exists).
    const retry = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        organizationId: readyOrganizationId,
        senderId: 'ready-owner',
        recipientId: 'ready-agent',
        content: 'first ever dm via idempotency path',
        clientMessageId: 'dm-first-send',
      }),
    });
    expect(retry.status).toBe(200);
    const retryBody = (await retry.json()) as { id: string };
    expect(retryBody.id).toBe(body.id);
  });

  it('returns 403 Forbidden when trying to delete a human member', async () => {
    const response = await fetch(`${baseUrl}/api/orgs/${readyOrganizationId}/members/ready-owner`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-ujima-session': readyOwnerSessionToken,
      },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe('ERR_FORBIDDEN');
    expect(body.message).toBe('Only agents can be deleted');
  });
});

function memberUpdateBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ready-agent',
    roleName: 'frontend-engineer',
    personalityName: 'direct',
    channelIds: ['general'],
    role: {
      name: 'frontend-engineer',
      title: 'Frontend Engineer',
      instructions: 'Build frontend',
      workspaceScopes: ['apps/web'],
      tools: ['filesystem', 'shell'],
      channels: ['general'],
      skills: [],
    },
    ...overrides,
  };
}

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
    const goals = new GoalSystemService(repo);
    const tools = new ToolServiceImpl(
      teamStore,
      repo,
      { requestApproval: () => ({ id: 'approval-1' }) },
      conversations,
      goals,
      realtime,
      {
        delegateAgentTurn: async () => ({ status: 'timed_out', agent: '', agent_id: '', thread_id: '', message_id: '' }),
        getDelegateStatus: async () => ({ status: 'timed_out', agent: '', agent_id: '', thread_id: '', message_id: '' }),
        waitForDelegates: async () => [],
        stopDelegate: async () => ({ stopped: false }),
        readDelegateThread: async () => [],
        sendToDelegate: async () => ({ sent: false, messageId: '' }),
      },
      new ApprovedRunScopeTracker(),
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
            tools: ['write', 'shell'],
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

  it('blocks shell traversal attempts that escape the workspace root', async () => {
    const fixture = await createToolFixture();

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-traversal',
      memberId: 'frontend-alice',
      toolCallId: 'tc-traversal',
      toolId: 'shell',
      action: 'execute',
      resourceType: 'shell',
      input: {
        command: 'cat',
        args: ['../../../etc/passwd'],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ERR_PATH_ESCAPE');
    expect(result.output).toMatchObject({
      status: 'blocked',
      code: 'ERR_PATH_ESCAPE',
    });
  });

  it('allows reads outside the member role scope without approval', async () => {
    const fixture = await createToolFixture();

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-scope',
      memberId: 'frontend-alice',
      toolCallId: 'tc-scope',
      toolId: 'view',
      action: 'read',
      resourceType: 'file',
      resourcePath: 'apps/api/server.ts',
      input: {},
    });

    expect(result.ok).toBe(true);
    expect(result.requiresApprovalId).toBeUndefined();
  });

  it.skipIf(skipIfWin32)('blocks symlink escapes that point outside the workspace root', async () => {
    const fixture = await createToolFixture();
    const outsideDir = await mkdtemp(join(tmpdir(), 'ujima-workspace-outside-'));
    tempDirs.push(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'outside\n', 'utf8');
    await symlink(outsideDir, join(fixture.workspaceRoot, 'apps', 'web', 'outside-link'));

    const result = await fixture.tools.invoke({
      organizationId: fixture.organizationId,
      runId: 'run-symlink',
      memberId: 'frontend-alice',
      toolCallId: 'tc-symlink',
      toolId: 'view',
      action: 'read',
      resourceType: 'file',
      resourcePath: 'apps/web/outside-link/secret.txt',
      input: {},
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('ERR_PATH_ESCAPE');
    expect(result.output).toMatchObject({
      status: 'blocked',
      code: 'ERR_PATH_ESCAPE',
    });
  });

  it('requires approval for shell cwd values outside the member role scope', async () => {
    const fixture = await createToolFixture();

    const result = await fixture.tools.invoke({
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
    });

    expect(result.ok).toBe(false);
    expect(result.requiresApprovalId).toBe('approval-1');
    expect(result.output).toMatchObject({
      status: 'waiting_for_approval',
      approvalId: 'approval-1',
    });
  });

  it.skipIf(skipIfWin32)('allows shell -c command strings without treating them as filesystem paths', async () => {
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

  it.skipIf(skipIfWin32)('does not rewrite ordinary slash-containing shell args as filesystem paths', async () => {
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

  it.skipIf(skipIfWin32)('resolves positional file operands for file-oriented shell commands relative to cwd', async () => {
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
      toolId: 'write',
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
      toolId: 'view',
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
