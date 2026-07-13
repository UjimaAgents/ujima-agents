import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState } from '@ujima/orchestrator';
import {
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  validateWorkflowGraph,
  type WorkflowDefinition,
} from '@ujima/shared';
import { z } from 'zod';
import { readSessionToken } from '../session-token.js';

interface WorkflowRouteDeps {
  repo: Repository;
  auth: AuthService;
}

type AuthedMember = AuthState & {
  user: NonNullable<AuthState['user']>;
  member: NonNullable<AuthState['member']>;
};

const DefinitionInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
});

function requireMember(
  deps: WorkflowRouteDeps,
  req: FastifyRequest,
  reply: FastifyReply,
): AuthedMember | null {
  const authState = deps.auth.getAuthState(readSessionToken(req));
  if (!authState.user || !authState.member) {
    reply.status(401).send({ code: 'ERR_UNAUTHORIZED', message: 'Unauthorized' });
    return null;
  }
  return { ...authState, user: authState.user, member: authState.member };
}

function sendRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  const status = /forbidden/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
  return reply.status(status).send({
    code: status === 403 ? 'ERR_FORBIDDEN' : status === 404 ? 'ERR_NOT_FOUND' : 'ERR_BAD_REQUEST',
    message,
  });
}

/** Structural + agent-existence validation, returns issue list (empty = ok). */
function validate(
  deps: WorkflowRouteDeps,
  organizationId: string,
  body: z.infer<typeof DefinitionInputSchema>,
): { code: string; message: string }[] {
  const agentIds = new Set(
    deps.repo
      .listMembers(organizationId)
      .filter((m) => m.kind === 'agent' && !m.retiredAt)
      .map((m) => m.id),
  );
  const result = validateWorkflowGraph(
    { nodes: body.nodes, edges: body.edges },
    { agentIds },
  );
  return result.issues.map((i) => ({ code: i.code, message: i.message }));
}

export function registerWorkflowRoutes(api: FastifyInstance, deps: WorkflowRouteDeps): void {
  // --- Definitions --------------------------------------------------------

  api.get('/workflows', async (req, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    return reply.status(200).send({
      workflows: deps.repo.listWorkflowDefinitions(auth.user.organizationId),
    });
  });

  api.get('/workflows/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const def = deps.repo.getWorkflowDefinition(auth.user.organizationId, req.params.id);
    if (!def) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow not found' });
    return reply.status(200).send({ workflow: def });
  });

  api.post('/workflows', async (req, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      const parsed = DefinitionInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(422).send({
          code: 'ERR_INVALID_WORKFLOW',
          message: 'Invalid workflow definition',
          issues: parsed.error.issues.map((i) => ({ code: 'schema', message: `${i.path.join('.')}: ${i.message}` })),
        });
      }
      const issues = validate(deps, auth.user.organizationId, parsed.data);
      if (issues.length > 0) {
        return reply.status(422).send({ code: 'ERR_INVALID_WORKFLOW', message: 'Invalid workflow graph', issues });
      }
      const body = parsed.data;
      const nowIso = new Date().toISOString();
      const def: WorkflowDefinition = {
        id: randomUUID(),
        organizationId: auth.user.organizationId,
        name: body.name,
        description: body.description,
        nodes: body.nodes,
        edges: body.edges,
        version: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      deps.repo.saveWorkflowDefinition(def);
      return reply.status(201).send({ workflow: def });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  api.put('/workflows/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    try {
      const existing = deps.repo.getWorkflowDefinition(auth.user.organizationId, req.params.id);
      if (!existing) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow not found' });
      const parsed = DefinitionInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(422).send({
          code: 'ERR_INVALID_WORKFLOW',
          message: 'Invalid workflow definition',
          issues: parsed.error.issues.map((i) => ({ code: 'schema', message: `${i.path.join('.')}: ${i.message}` })),
        });
      }
      const body = parsed.data;
      const issues = validate(deps, auth.user.organizationId, body);
      if (issues.length > 0) {
        return reply.status(422).send({ code: 'ERR_INVALID_WORKFLOW', message: 'Invalid workflow graph', issues });
      }
      const def: WorkflowDefinition = {
        ...existing,
        name: body.name,
        description: body.description,
        nodes: body.nodes,
        edges: body.edges,
        version: existing.version + 1,
        updatedAt: new Date().toISOString(),
      };
      deps.repo.saveWorkflowDefinition(def);
      return reply.status(200).send({ workflow: def });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  api.delete('/workflows/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    deps.repo.deleteWorkflowDefinition(auth.user.organizationId, req.params.id);
    return reply.status(204).send();
  });

  // --- Runs (read-only; execution wiring lands with the engine adapter) ---

  api.get('/workflow-runs', async (
    req: FastifyRequest<{ Querystring: { status?: string } }>,
    reply,
  ) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    return reply.status(200).send({
      runs: deps.repo.listWorkflowRuns(auth.user.organizationId, req.query.status),
    });
  });

  api.get('/workflow-runs/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const run = deps.repo.getWorkflowRun(auth.user.organizationId, req.params.id);
    if (!run) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow run not found' });
    return reply.status(200).send({
      run,
      nodeRuns: deps.repo.listWorkflowNodeRuns(run.id),
    });
  });
}
