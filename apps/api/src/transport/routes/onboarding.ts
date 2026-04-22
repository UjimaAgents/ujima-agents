import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingRequestSchema, OnboardingResponseSchema, BootstrapResponseSchema, ApiErrorSchema } from '@ujima/api-schema';
import type { BootstrapService, OnboardingService } from '@ujima/orchestrator';

export interface OnboardingRoutesOptions {
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
}

export function registerOnboardingRoutes(
  _app: FastifyInstance,
  options: OnboardingRoutesOptions,
): void {
  const { bootstrap, onboarding } = options;
  const app = _app.withTypeProvider<ZodTypeProvider>();

  app.get('/bootstrap', {
    schema: {
      description: 'Retrieve current system bootstrap state',
      tags: ['Onboarding'],
      response: {
        200: BootstrapResponseSchema,
      },
    },
  }, async () => {
    return bootstrap.getBootstrap();
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
      return await onboarding.onboard(req.body);
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
