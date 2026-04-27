import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingRequestSchema, OnboardingResponseSchema, BootstrapResponseSchema, ApiErrorSchema } from '@ujima/api-schema';
import type { AuthService, BootstrapService, OnboardingService } from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';

export interface OnboardingRoutesOptions {
  auth: AuthService;
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
}

export function registerOnboardingRoutes(
  _app: FastifyInstance,
  options: OnboardingRoutesOptions,
): void {
  const { auth, bootstrap, onboarding } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/bootstrap', {
    schema: {
      description: 'Retrieve current system bootstrap state',
      tags: ['Onboarding'],
      response: {
        200: BootstrapResponseSchema,
      },
    },
  }, async (req) => {
    return bootstrap.getBootstrap({ sessionToken: readSessionToken(req) });
  });

  app.post('/onboarding', {
    schema: {
      description: 'Initial system onboarding and organization setup',
      tags: ['Onboarding'],
      body: OnboardingRequestSchema,
      response: {
        200: OnboardingResponseSchema,
        400: ApiErrorSchema,
      },
    },
  }, async (req, reply) => {
    try {
      const result = await onboarding.onboard(req.body);
      const owner = result.members.find(
        (member) => member.kind === 'human' && member.roleName === 'owner',
      );
      if (!owner) {
        throw new Error('onboarding did not create an owner member');
      }
      const session = auth.registerOwnerAccount({
        organizationId: result.organization.id,
        memberId: owner.id,
        email: req.body.ownerEmail,
        password: req.body.ownerPassword,
      });
      return {
        ...result,
        auth: {
          authenticated: true as const,
          user: session.user,
          member: session.member,
          session: session.session,
        },
        sessionToken: session.sessionToken,
      };
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: 'ERR_BAD_REQUEST', message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
