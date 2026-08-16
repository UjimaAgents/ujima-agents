import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, WorkflowEngineService } from '@ujima/orchestrator';
import {
  WorkflowEdgeSchema,
  WorkflowNodeSchema,
  WorkflowPortSchema,
  WorkflowTransitionActionSchema,
  normalizeWorkflowGraph,
  validateWorkflowGraph,
  type WorkflowDefinition,
} from '@ujima/shared';
import { z } from 'zod';
import { readSessionToken } from '../session-token.js';
import { buildWorkflowApprovalView, buildWorkflowRunView } from '../workflow-run-view.js';

interface WorkflowRouteDeps {
  repo: Repository;
  auth: AuthService;
  workflowEngine: WorkflowEngineService;
}

type AuthedMember = AuthState & {
  user: NonNullable<AuthState['user']>;
  member: NonNullable<AuthState['member']>;
};

const DefinitionInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  channelId: z.string().min(1).nullable().optional(),
  nodes: z.array(WorkflowNodeSchema),
  // Keep ports optional until the shared graph normalizer can infer legacy
  // capability edges from their source node kind.
  edges: z.array(z.object({
    id: WorkflowEdgeSchema.shape.id,
    source: WorkflowEdgeSchema.shape.source,
    sourcePort: WorkflowPortSchema.optional(),
    target: WorkflowEdgeSchema.shape.target,
    targetPort: WorkflowPortSchema.optional(),
  })),
});

/**
 * Turn Zod schema errors into the same issue shape the graph validator uses,
 * attaching the offending node's id (from a `nodes.<index>.…` path) so the
 * editor can tag which node on the canvas is wrong instead of showing a bare
 * dotted path.
 */
function schemaIssues(body: unknown, error: z.ZodError): { code: string; message: string; nodeId?: string }[] {
  const nodes = (body as { nodes?: { id?: unknown }[] } | null)?.nodes;
  return error.issues.map((i) => {
    let nodeId: string | undefined;
    if (i.path[0] === 'nodes' && typeof i.path[1] === 'number' && Array.isArray(nodes)) {
      const id = nodes[i.path[1]]?.id;
      if (typeof id === 'string') nodeId = id;
    }
    return { code: 'schema', message: `${i.path.join('.')}: ${i.message}`, nodeId };
  });
}

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
  const result = validateWorkflowGraph(normalizeWorkflowGraph(body), { agentIds });
  return result.issues.map((i) => ({ code: i.code, message: i.message }));
}

// Curated set of tools that make sense as agent sub-nodes in a workflow.
const WORKFLOW_TOOL_CATALOG = [
  'web_search',
  'fetch',
  'download',
  'view',
  'ls',
  'glob',
  'grep',
];

export function registerWorkflowRoutes(api: FastifyInstance, deps: WorkflowRouteDeps): void {
  // --- Catalog (agents + tools + skills) for the editor dropdowns ---------
  api.get('/workflow-catalog', async (req, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const orgId = auth.user.organizationId;

    const agents = deps.repo
      .listMembers(orgId)
      .filter((m) => m.kind === 'agent' && !m.retiredAt)
      .map((m) => ({ id: m.id, name: m.name, role: m.roleName }));

    // Builtin tools + every MCP server's cached tools.
    const tools: { id: string; label: string; group: string }[] = WORKFLOW_TOOL_CATALOG.map(
      (id) => ({ id, label: id, group: 'builtin' }),
    );
    for (const server of deps.repo.listMcpServers(orgId)) {
      const cache = deps.repo.getMcpToolCache(orgId, server.id);
      for (const tool of cache?.tools ?? []) {
        tools.push({
          id: `mcp:${server.id}:${tool.name}`,
          label: `${server.name} · ${tool.name}`,
          group: server.name,
        });
      }
    }

    const skills = (deps.repo.listOrganizationSkillInstalls?.(orgId) ?? []).map((s) => ({
      name: s.skillName,
      description: s.description,
    }));

    return reply.status(200).send({ agents, tools, skills });
  });

  // --- Definitions --------------------------------------------------------

  api.get('/workflows', async (
    req: FastifyRequest<{ Querystring: { channelId?: string } }>,
    reply,
  ) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const workflows = req.query.channelId
      ? deps.repo.listWorkflowDefinitionsForChannel(auth.user.organizationId, req.query.channelId)
      : deps.repo.listWorkflowDefinitions(auth.user.organizationId);
    return reply.status(200).send({ workflows });
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
          issues: schemaIssues(req.body, parsed.error),
        });
      }
      const issues = validate(deps, auth.user.organizationId, parsed.data);
      if (issues.length > 0) {
        return reply.status(422).send({ code: 'ERR_INVALID_WORKFLOW', message: 'Invalid workflow graph', issues });
      }
      const body = parsed.data;
      const graph = normalizeWorkflowGraph(body);
      const nowIso = new Date().toISOString();
      const def: WorkflowDefinition = {
        id: randomUUID(),
        organizationId: auth.user.organizationId,
        channelId: body.channelId ?? null,
        name: body.name,
        description: body.description,
        nodes: graph.nodes,
        edges: graph.edges,
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
          issues: schemaIssues(req.body, parsed.error),
        });
      }
      const body = parsed.data;
      const graph = normalizeWorkflowGraph(body);
      const issues = validate(deps, auth.user.organizationId, body);
      if (issues.length > 0) {
        return reply.status(422).send({ code: 'ERR_INVALID_WORKFLOW', message: 'Invalid workflow graph', issues });
      }
      const def: WorkflowDefinition = {
        ...existing,
        channelId: body.channelId === undefined ? existing.channelId : body.channelId,
        name: body.name,
        description: body.description,
        nodes: graph.nodes,
        edges: graph.edges,
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
    return reply.status(200).send(buildWorkflowRunView(deps.repo, run));
  });

  // Pending workflow approval gates for the org, shaped for the shared approval
  // queue (the "Approval N of M" card + floating pending pill). Derived live from
  // run/node-run state so it always reflects reality (resolved gates drop off).
  api.get('/workflow-approvals', async (req: FastifyRequest, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    return reply.status(200).send(buildWorkflowApprovalView(deps.repo, auth.user.organizationId));
  });

  // Read a run's produced artifact (an agent node's output file). Scoped hard to
  // the paths this run actually wrote — no arbitrary workspace reads.
  const ARTIFACT_MAX_BYTES = 256 * 1024;
  api.get('/workflow-runs/:id/artifact', async (
    req: FastifyRequest<{ Params: { id: string }; Querystring: { path?: string } }>,
    reply,
  ) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const run = deps.repo.getWorkflowRun(auth.user.organizationId, req.params.id);
    if (!run) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow run not found' });
    const relPath = (req.query.path ?? '').trim();
    if (!relPath) return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'path is required' });

    const allowed = new Set(
      deps.repo
        .listWorkflowNodeRuns(run.id)
        .map((nr) => nr.outputPath)
        .filter((p): p is string => Boolean(p)),
    );
    if (!allowed.has(relPath)) {
      return reply.status(403).send({ code: 'ERR_FORBIDDEN', message: 'path is not an artifact of this run' });
    }

    const root = deps.repo.getOrganization(auth.user.organizationId)?.workspace?.root?.trim();
    if (!root) return reply.status(400).send({ code: 'ERR_NO_WORKSPACE_ROOT', message: 'No workspace root' });

    const rootResolved = resolve(root);
    const absResolved = resolve(join(root, relPath));
    if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + sep)) {
      return reply.status(403).send({ code: 'ERR_FORBIDDEN', message: 'path escapes workspace' });
    }
    try {
      const stat = statSync(absResolved);
      if (!stat.isFile()) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Artifact not found' });
      const buf = readFileSync(absResolved);
      const truncated = buf.length > ARTIFACT_MAX_BYTES;
      return reply.status(200).send({
        path: relPath,
        content: buf.subarray(0, ARTIFACT_MAX_BYTES).toString('utf8'),
        sizeBytes: stat.size,
        truncated,
      });
    } catch {
      return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Artifact not found' });
    }
  });

  // Start a run. Requires a channel + thread to run the agent steps in.
  api.post('/workflows/:id/run', async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const parsed = z
      .object({ input: z.string().default(''), channelId: z.string().min(1), threadId: z.string().min(1) })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'channelId and threadId are required' });
    }
    const def = deps.repo.getWorkflowDefinition(auth.user.organizationId, req.params.id);
    if (!def) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow not found' });
    try {
      const { workflowRunId } = await deps.workflowEngine.startRun({
        organizationId: auth.user.organizationId,
        definitionId: def.id,
        input: parsed.data.input,
        initiatedBy: auth.member.id,
        channelId: parsed.data.channelId,
        threadId: parsed.data.threadId,
      });
      return reply.status(201).send({ workflow_run_id: workflowRunId });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  const TransitionBodySchema = z.object({
    action: WorkflowTransitionActionSchema,
    idempotency_key: z.string().min(1),
    rejection_reason: z.string().optional(),
  });

  api.post('/workflow-runs/:id/transition', async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply,
  ) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const run = deps.repo.getWorkflowRun(auth.user.organizationId, req.params.id);
    if (!run) return reply.status(404).send({ code: 'ERR_NOT_FOUND', message: 'Workflow run not found' });
    const parsed = TransitionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'ERR_BAD_REQUEST', message: 'action and idempotency_key are required' });
    }
    try {
      const result = await deps.workflowEngine.transition({
        organizationId: auth.user.organizationId,
        workflowRunId: run.id,
        action: parsed.data.action,
        idempotencyKey: parsed.data.idempotency_key,
        rejectionReason: parsed.data.rejection_reason,
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });
}
