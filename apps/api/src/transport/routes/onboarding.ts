import type { FastifyInstance, FastifyReply } from 'fastify';
import { OnboardingRequestSchema } from '@ujima/api-schema';
import type { BootstrapService, OnboardingService } from '@ujima/orchestrator';

export interface OnboardingRoutesOptions {
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
}

export function registerOnboardingRoutes(
  app: FastifyInstance,
  options: OnboardingRoutesOptions,
): void {
  const { bootstrap, onboarding } = options;

  app.get('/api/bootstrap', async () => {
    return bootstrap.getBootstrap();
  });

  app.post('/api/onboarding', async (req, reply) => {
    const body = OnboardingRequestSchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, body.error.message);
    try {
      return await onboarding.onboard(body.data);
    } catch (err) {
      return badRequest(reply, errMessage(err));
    }
  });
}

function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: message });
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
