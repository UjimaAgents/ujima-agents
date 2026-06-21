import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@ujima/context-store';
import { Repository } from '@ujima/runtime-core';
import {
  AuthService,
  createScheduledJobRecord,
} from '@ujima/orchestrator';
import { ChannelSchema, MemberSchema, OrganizationSchema } from '@ujima/shared';
import { registerHeartbeatRoutes } from '../src/transport/routes/heartbeats';

describe('heartbeat routes', () => {
  const organizationId = 'org-1';
  const memberId = 'member-1';
  const channelId = 'general';

  let app: ReturnType<typeof Fastify>;
  let repo: Repository;
  let sessionToken: string;

  beforeEach(() => {
    repo = new Repository(openDatabase({ dbPath: ':memory:' }));
    repo.saveOrganization(
      OrganizationSchema.parse({
        id: organizationId,
        name: 'Heartbeat Org',
        workspace: { root: '', roleScopes: {} },
        organizationChart: { reportsTo: {} },
      }),
    );
    repo.saveMember(
      MemberSchema.parse({
        id: memberId,
        organizationId,
        name: 'Owner',
        kind: 'human',
        roleName: 'owner',
      }),
    );
    repo.saveChannel(
      ChannelSchema.parse({
        id: channelId,
        organizationId,
        name: 'general',
        kind: 'general',
        topic: '',
        memberIds: [memberId],
      }),
    );

    const auth = new AuthService(repo);
    sessionToken = auth
      .registerOwnerAccount({
        organizationId,
        memberId,
        email: 'owner@example.com',
        password: 'password',
      })
      .sessionToken;

    app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    registerHeartbeatRoutes(app, { repo, auth });
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires a channel and preserves the heartbeat type', async () => {
    const badCreate = await app.inject({
      method: 'POST',
      url: '/heartbeats',
      headers: { 'x-ujima-session': sessionToken },
      payload: {
        name: 'Daily check',
        cronExpression: '0 9 * * *',
        prompt: 'Check in',
      },
    });

    expect(badCreate.statusCode).toBe(400);

    const create = await app.inject({
      method: 'POST',
      url: '/heartbeats',
      headers: { 'x-ujima-session': sessionToken },
      payload: {
        name: 'Daily check',
        cronExpression: '0 9 * * *',
        prompt: 'Check in',
        channelId,
      },
    });

    expect(create.statusCode).toBe(201);
    const created = create.json() as { job: { id: string; type: string; channelId: string; status: string } };
    expect(created.job.type).toBe('heartbeat');
    expect(created.job.channelId).toBe(channelId);

    repo.saveScheduledJob(
      createScheduledJobRecord({
        organizationId,
        memberId,
        name: 'Standup',
        cronExpression: '0 8 * * 1-5',
        prompt: 'Daily standup',
        channelId,
      }),
    );

    const list = await app.inject({
      method: 'GET',
      url: '/heartbeats',
      headers: { 'x-ujima-session': sessionToken },
    });

    expect(list.statusCode).toBe(200);
    const listed = list.json() as { jobs: Array<{ type: string; id: string }> };
    expect(listed.jobs).toHaveLength(1);
    expect(listed.jobs[0]?.type).toBe('heartbeat');
  });

  it('updates, pauses, resumes, and deletes a heartbeat', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/heartbeats',
      headers: { 'x-ujima-session': sessionToken },
      payload: {
        name: 'Daily check',
        cronExpression: '0 9 * * *',
        prompt: 'Check in',
        channelId,
      },
    });

    const created = create.json() as { job: { id: string } };

    const paused = await app.inject({
      method: 'PATCH',
      url: `/heartbeats/${created.job.id}`,
      headers: { 'x-ujima-session': sessionToken },
      payload: {
        status: 'paused',
        prompt: 'Check in harder',
        channelId,
      },
    });

    expect(paused.statusCode).toBe(200);
    const pausedBody = paused.json() as { job: { type: string; status: string; channelId: string } };
    expect(pausedBody.job.type).toBe('heartbeat');
    expect(pausedBody.job.status).toBe('paused');
    expect(pausedBody.job.channelId).toBe(channelId);

    const resumed = await app.inject({
      method: 'PATCH',
      url: `/heartbeats/${created.job.id}`,
      headers: { 'x-ujima-session': sessionToken },
      payload: {
        status: 'active',
        channelId,
      },
    });

    expect(resumed.statusCode).toBe(200);
    expect((resumed.json() as { job: { status: string } }).job.status).toBe('active');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/heartbeats/${created.job.id}`,
      headers: { 'x-ujima-session': sessionToken },
    });

    expect(deleted.statusCode).toBe(204);
  });
});
