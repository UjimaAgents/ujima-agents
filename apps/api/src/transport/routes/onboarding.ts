import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { OnboardingRequestSchema, OnboardingResponseSchema, BootstrapResponseSchema, ApiErrorSchema } from '@ujima/api-schema';
import type { OnboardingResponse } from '@ujima/api-schema';
import type {
  ApiRepository,
  AuthService,
  BootstrapService,
  OnboardingService,
  TeamStore,
} from '@ujima/orchestrator';
import { readSessionToken } from '../session-token.js';
import { apiError, errorMessage } from './route-errors.js';

const completedAttempts = new Map<string, OnboardingResponse>();

export interface OnboardingRoutesOptions {
  auth: AuthService;
  bootstrap: BootstrapService;
  onboarding: OnboardingService;
  repo: ApiRepository;
  teamStore: TeamStore;
}

export function registerOnboardingRoutes(
  _app: FastifyInstance,
  options: OnboardingRoutesOptions,
): void {
  const { auth, bootstrap, onboarding, repo, teamStore } = options;
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
    if (req.body.attemptId && completedAttempts.has(req.body.attemptId)) {
      return completedAttempts.get(req.body.attemptId);
    }
    let organizationId: string | undefined;
    try {
      const result = await onboarding.onboard({
        ...req.body,
        team: {
          ...req.body.team,
          organizationChart: req.body.team.organizationChart ?? { reportsTo: {} },
        },
      });
      organizationId = result.organization.id;
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
      const response = {
        ...result,
        auth: {
          authenticated: true as const,
          user: session.user,
          member: session.member,
          session: session.session,
        },
        sessionToken: session.sessionToken,
      };
      if (req.body.attemptId) {
        completedAttempts.set(req.body.attemptId, response);
      }
      return response;
    } catch (err) {
      if (organizationId) {
        try {
          repo.deleteOrganizationData(organizationId);
          teamStore.clearTeam(organizationId);
        } catch {
          // Best-effort rollback so a failed sign-up does not strand a login-less org.
        }
      }
      return apiError(reply, 400, errorMessage(err));
    }
  });
}
