import { randomUUID } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Repository } from '@ujima/runtime-core';
import type { AuthService, AuthState, WorkflowEngineService } from '@ujima/orchestrator';
import {
  WorkflowEdgeSchema,
  WorkflowGraphSchema,
  WorkflowNodeSchema,
  WorkflowTransitionActionSchema,
  validateWorkflowGraph,
  type WorkflowDefinition,
} from '@ujima/shared';
import { z } from 'zod';
import { readSessionToken } from '../session-token.js';

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
  edges: z.array(WorkflowEdgeSchema),
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
  const result = validateWorkflowGraph(
    { nodes: body.nodes, edges: body.edges },
    { agentIds },
  );
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
      const nowIso = new Date().toISOString();
      const def: WorkflowDefinition = {
        id: randomUUID(),
        organizationId: auth.user.organizationId,
        channelId: body.channelId ?? null,
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
          issues: schemaIssues(req.body, parsed.error),
        });
      }
      const body = parsed.data;
      const issues = validate(deps, auth.user.organizationId, body);
      if (issues.length > 0) {
        return reply.status(422).send({ code: 'ERR_INVALID_WORKFLOW', message: 'Invalid workflow graph', issues });
      }
      const def: WorkflowDefinition = {
        ...existing,
        channelId: body.channelId === undefined ? existing.channelId : body.channelId,
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
    const orgId = auth.user.organizationId;
    const memberName = (id: string | null | undefined) =>
      id ? (deps.repo.getMember(orgId, id)?.name ?? id) : undefined;
    // Node runs carry the execution timeline; resolve the agent behind each one
    // plus the tool calls it made, so the run view can show who did what, when —
    // the agent's actual activity, not just its final text.
    const nodeRuns = deps.repo.listWorkflowNodeRuns(run.id).map((nr) => {
      // The node's failureReason is generic ('agent_run_failed'); the real error
      // lives on the child agent run's summary. Surface it so the timeline shows
      // what actually went wrong (e.g. a context-length overflow).
      const childSummary = nr.childRunId ? deps.repo.getRun(orgId, nr.childRunId)?.summary : undefined;
      return {
        ...nr,
        agentName: memberName(nr.agentId),
        failureDetail:
          nr.status === 'failed' && childSummary && childSummary !== nr.failureReason
            ? childSummary
            : undefined,
        toolSteps: nr.childRunId
          ? (deps.repo.listRunSteps?.(orgId, nr.childRunId) ?? [])
              .slice(-60)
              .map((s) => ({
                tool: s.toolId,
                action: s.action,
                status: s.status,
                resourcePath: s.resourcePath || undefined,
                at: s.createdAt,
              }))
          : [],
      };
    });
    // A child agent run can stall on its own tool approval (a filesystem write,
    // an MCP call). That approval lives in the isolated run thread and otherwise
    // never reaches the operator — so the run looks "stuck". Surface it here so
    // the run view can show + resolve it.
    const childNodeByRun = new Map(
      nodeRuns.filter((n) => n.childRunId).map((n) => [n.childRunId as string, n.nodeId]),
    );
    const blockingApprovals = deps.repo
      .listPendingApprovals(orgId)
      .filter((a) => a.runId && childNodeByRun.has(a.runId))
      .map((a) => ({
        id: a.id,
        nodeId: childNodeByRun.get(a.runId as string),
        agentName: memberName(a.requestedBy),
        resourceType: a.resourceType,
        action: a.action,
        resourcePath: a.resourcePath,
      }));
    // The run executes in a dedicated thread — surface its conversation, but drop
    // the workflow's own status cards/reminders (▶ started / ✅ completed / ⚠️
    // needs attention). Those are channel meta, not agent interaction.
    const isStatusNoise = (content: string) =>
      /^\s*(▶|✅|⛔|⚠️)\s*Workflow\b/.test(content) ||
      /^\s*\[\[CONVERSATION_SUMMARY/.test(content);
    const messages = deps.repo
      .listMessages(orgId, run.threadId, undefined, 100)
      .data.slice()
      .reverse()
      .filter((m) => !isStatusNoise(m.content ?? ''))
      .map((m) => ({
        id: m.id,
        senderName: memberName(m.senderId) ?? m.senderId,
        senderKind: m.senderKind,
        content: m.content,
        createdAt: m.createdAt,
      }));
    return reply.status(200).send({
      run,
      nodeRuns,
      messages,
      blockingApprovals,
    });
  });

  // Pending workflow approval gates for the org, shaped for the shared approval
  // queue (the "Approval N of M" card + floating pending pill). Derived live from
  // run/node-run state so it always reflects reality (resolved gates drop off).
  api.get('/workflow-approvals', async (req: FastifyRequest, reply) => {
    const auth = requireMember(deps, req, reply);
    if (!auth) return;
    const orgId = auth.user.organizationId;
    const memberName = (id: string | null | undefined) =>
      id ? (deps.repo.getMember(orgId, id)?.name ?? id) : undefined;
    const runs = deps.repo.listWorkflowRuns(orgId, 'awaiting_approval');
    const approvals: unknown[] = [];
    for (const run of runs) {
      const nodeRuns = deps.repo.listWorkflowNodeRuns(run.id);
      const gates = nodeRuns.filter((nr) => nr.status === 'awaiting_approval');
      if (gates.length === 0) continue;
      let promptByNode = new Map<string, string | undefined>();
      try {
        const graph = WorkflowGraphSchema.parse(JSON.parse(run.graphSnapshot));
        for (const node of graph.nodes) {
          if (node.kind === 'approval') promptByNode.set(node.id, node.config.prompt);
        }
      } catch {
        promptByNode = new Map();
      }
      // Nearest prior output: the most recently completed step in this run.
      const lastCompleted = nodeRuns
        .filter((nr) => nr.status === 'completed')
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
      for (const gate of gates) {
        approvals.push({
          id: gate.approvalRequestId ?? gate.id,
          workflowRunId: run.id,
          workflowName: run.name,
          nodeId: gate.nodeId,
          prompt: promptByNode.get(gate.nodeId) ?? '',
          priorSummary: lastCompleted?.summary ?? undefined,
          priorOutputPath: lastCompleted?.outputPath ?? undefined,
          channelId: run.channelId,
          requestedBy: run.initiatedBy,
          createdAt: gate.startedAt ?? run.createdAt,
        });
      }
    }
    // Tool approvals blocking a RUNNING run's agent step (a write/MCP the child
    // agent needs approved). These are real ApprovalService approvals; surface
    // them so the global pending pill shows them without opening the run.
    const toolApprovals: unknown[] = [];
    const pending = deps.repo.listPendingApprovals(orgId);
    if (pending.length > 0) {
      for (const run of deps.repo.listWorkflowRuns(orgId, 'running')) {
        const childNodeByRun = new Map(
          deps.repo
            .listWorkflowNodeRuns(run.id)
            .filter((n) => n.childRunId)
            .map((n) => [
              n.childRunId as string,
              { nodeId: n.nodeId, agentId: n.agentId, agentName: memberName(n.agentId) },
            ]),
        );
        for (const a of pending) {
          const link = a.runId ? childNodeByRun.get(a.runId) : undefined;
          if (!link) continue;
          toolApprovals.push({
            id: a.id,
            workflowRunId: run.id,
            workflowName: run.name,
            nodeId: link.nodeId,
            // Stable member id of the agent whose step needs the tool (for
            // avatars/filtering); agentName is display-only.
            requestedByMemberId: link.agentId ?? a.requestedBy,
            agentName: link.agentName ?? memberName(a.requestedBy),
            resourceType: a.resourceType,
            action: a.action,
            resourcePath: a.resourcePath,
            channelId: run.channelId,
            createdAt: a.createdAt,
          });
        }
      }
    }
    return reply.status(200).send({ approvals, toolApprovals });
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
