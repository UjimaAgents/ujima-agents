import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import {
  ApiErrorSchema,
  GovernancePolicyResponseSchema,
  McpScopedQuerySchema,
  UpdateRiskDefaultsRequestSchema,
} from '@ujima/api-schema';
import type { AuthService, GovernanceService } from '@ujima/orchestrator';
import { apiError } from './route-errors.js';
import {
  registerOrgSettingsRoute,
  settingsServerErrors,
  withTypeProvider,
} from './org-settings-route.js';

export interface GovernanceRoutesOptions {
  auth: AuthService;
  governance: GovernanceService;
}

const errors = settingsServerErrors;
const writeErrors = { ...errors, 400: ApiErrorSchema, 409: ApiErrorSchema };

function handle(reply: FastifyReply, err: unknown): FastifyReply {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith('Organization not found')) {
    return apiError(reply, 404, message, 'ERR_NOT_FOUND');
  }
  return apiError(reply, 500, message, 'ERR_INTERNAL');
}

export function registerGovernanceRoutes(
  fastify: FastifyInstance,
  options: GovernanceRoutesOptions,
): void {
  const { auth, governance } = options;
  const app = withTypeProvider(fastify);

  registerOrgSettingsRoute(app, 'get', '/settings/governance/policy', auth, {
    tags: ['Governance'],
    description:
      'Return the active governance policy for an org (risk_defaults + agent + platform rules). Empty `inherit` defaults when none has been saved.',
    querystring: McpScopedQuerySchema,
    response: { 200: GovernancePolicyResponseSchema, ...errors },
    organizationId: (req) => (req.query as { organizationId: string }).organizationId,
    onError: handle,
    handler: async (_req, organizationId) => ({
      policy: governance.get(organizationId),
    }),
  });

  registerOrgSettingsRoute(
    app,
    'patch',
    '/settings/governance/policy/risk-defaults',
    auth,
    {
      tags: ['Governance'],
      description:
        'Update the per-class risk defaults. Partial — only provided classes are changed; the rest are preserved.',
      body: UpdateRiskDefaultsRequestSchema,
      response: { 200: GovernancePolicyResponseSchema, ...writeErrors },
      organizationId: (req) => (req.body as { organizationId: string }).organizationId,
      onError: handle,
      handler: async (req, organizationId) => {
        const body = req.body as z.infer<typeof UpdateRiskDefaultsRequestSchema>;
        return {
          policy: governance.updateRiskDefaults(organizationId, body.riskDefaults),
        };
      },
    },
  );
}
