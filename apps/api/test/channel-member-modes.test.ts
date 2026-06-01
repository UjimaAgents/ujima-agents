import fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { registerChannelMemberModeRoutes } from '../src/transport/routes/channel-member-modes.js';

describe('channel-member-modes routes', () => {
  it('checks auth before workspace-root validation on PUT', async () => {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const repo = {
      getOrganization: () => {
        throw new Error('workspace root should not be checked before auth');
      },
    } as never;

    registerChannelMemberModeRoutes(app, {
      repo,
      auth: {
        getAuthState: () => ({ user: null, member: null }),
      } as never,
    });

    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/orgs/org-1/channels/channel-1/modes',
        payload: { memberId: 'agent-1', mode: 'active' },
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
