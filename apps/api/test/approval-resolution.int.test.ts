import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferLogger, createRuntimeHost, Repository, type RuntimeHost } from '@ujima/runtime-core';
import { ApprovalRequestSchema, MemberSchema, OrganizationSchema, RunStateSchema } from '@ujima/shared';
import { AuthService } from '@ujima/orchestrator';
import { createTransport, type Transport } from '../src/transport/server';
import type { LanguageModel } from 'ai';

const TOKEN = 'c'.repeat(64);

const stubLanguageModel = {} as unknown as LanguageModel;

describe('approval resolution route', () => {
  let homeDir: string;
  let host: RuntimeHost;
  let transport: Transport;
  let baseUrl: string;
  let organizationId: string;
  let sessionToken: string;
  let runRecord = RunStateSchema.parse({
    id: 'run-1',
    organizationId: 'org-1',
    agentId: 'agent-1',
    status: 'waiting_for_approval',
    step: 'shell',
    summary: '',
    startedAt: new Date().toISOString(),
  });
  let approvalRecord = ApprovalRequestSchema.parse({
    id: 'approval-1',
    organizationId: 'org-1',
    runId: 'run-1',
    toolCallId: 'tool-1',
    requestedBy: 'agent-1',
    resourceType: 'shell',
    resourcePath: 'echo hi',
    action: 'execute',
    status: 'pending',
    reason: 'scope=echo%20hi',
    createdAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'ujima-approval-route-'));
    host = await createRuntimeHost(
      {
        homeDir,
        logger: createBufferLogger(),
        loadAgent: async () => undefined,
        loadTeam: async () => undefined,
        resolveMCPDef: async (_workspaceId, id) => {
          throw new Error(`no mcp ${id}`);
        },
        getModel: () => stubLanguageModel,
      },
      {},
    );

    const repo = new Repository(host.db.raw);
    organizationId = 'org-1';
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: organizationId,
        name: 'Approval Org',
        workspace: { root: homeDir, roleScopes: {} },
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

    const auth = new AuthService(repo);
    sessionToken = auth
      .registerOwnerAccount({
        organizationId,
        memberId: 'owner-1',
        email: 'owner@example.com',
        password: 'password',
      })
      .sessionToken;

    const runs = {
      getRun: (orgId: string, runId: string) =>
        orgId === organizationId && runId === runRecord.id ? runRecord : null,
      getRunDetail: () => null,
      listRuns: () => ({ data: [], nextCursor: undefined, hasMore: false }),
      createRun: async () => runRecord,
    };

    const approvals = {
      listPending: (orgId: string) =>
        orgId === organizationId && approvalRecord.status === 'pending' ? [approvalRecord] : [],
      resolveApproval: async ({
        organizationId: orgId,
        approvalId,
        status,
        reason,
      }: {
        organizationId: string;
        approvalId: string;
        status: 'approved' | 'rejected';
        reason?: string;
      }) => {
        if (orgId !== organizationId || approvalId !== approvalRecord.id) {
          throw new Error(`Approval not found: ${approvalId}`);
        }
        approvalRecord = {
          ...approvalRecord,
          status: status === 'rejected' ? 'rejected' : 'approved',
          reason: reason ?? '',
          resolvedAt: new Date().toISOString(),
        };
        if (status === 'rejected') {
          runRecord = {
            ...runRecord,
            status: 'failed',
            summary: 'Approval rejected by user',
            endedAt: new Date().toISOString(),
          };
        }
        return approvalRecord;
      },
    };

    transport = createTransport({
      host,
      token: TOKEN,
      logger: createBufferLogger(),
      bindHost: '127.0.0.1',
      port: 0,
      apiServices: {
        repo,
        buildServices: () =>
          ({
            conversations: {},
            runs,
            approvals,
            auth,
            bootstrap: {},
            onboarding: {},
            settings: {},
            taskPromoter: {},
            taskSessions: {},
            spirits: {},
            supervisorTodos: {},
            activeSpirits: {},
          } as any),
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

  it('rejects an approval without resuming the run', async () => {
    const response = await fetch(`${baseUrl}/api/approvals/approval-1/resolve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'x-ujima-session': sessionToken,
      },
      body: JSON.stringify({
        organizationId,
        resolution: 'reject',
        reason: 'Nope.',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 'approval-1',
      status: 'rejected',
      reason: 'Nope.',
    });

    const runResponse = await fetch(`${baseUrl}/api/runs/run-1?organizationId=${organizationId}`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
      },
    });
    expect(runResponse.status).toBe(200);
    expect(await runResponse.json()).toMatchObject({
      id: 'run-1',
      status: 'failed',
      summary: 'Approval rejected by user',
    });

    const approvalsResponse = await fetch(`${baseUrl}/api/approvals?organizationId=${organizationId}`, {
      headers: {
        authorization: `Bearer ${TOKEN}`,
      },
    });
    expect(approvalsResponse.status).toBe(200);
    expect(await approvalsResponse.json()).toEqual([]);
  });
});
