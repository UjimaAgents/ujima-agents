import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AGENT_KIND, getDirectMessageThreadId } from '@ujima/shared';
import type { OrchestratorTool, ToolExecutionContext } from './types.js';

const SEARCH_CATALOG_ACTIONS = ['search_catalog', 'create', 'list', 'inspect', 'retire', 'kill'] as const;

const AgentManageSchema = z.object({
  action: z.enum(SEARCH_CATALOG_ACTIONS).default('search_catalog').describe(
    'search_catalog — query available agent sources. create — spawn a temp agent. list — list temp agents for the current run. inspect — get details on one agent. retire — auto-retire a temp agent. kill — terminate and retire a temp agent.',
  ),
  query: z.string().optional().describe('Free-text search query for search_catalog.'),
  source: z.string().optional().describe('Agent source/def id for create. Use a member id or name from search_catalog results.'),
  mode: z.enum(['worker', 'explorer']).optional().describe('Agent mode for create — gates tool availability. worker has full tool access. explorer is read-only.'),
  keep: z.boolean().optional().describe('Keep agent alive after task completes (default false).'),
  config: z.record(z.string(), z.unknown()).optional().describe('Optional agent config overrides.'),
  agent_id: z.string().optional().describe('Target agent id for inspect, retire, or kill.'),
  scope: z.enum(['parent_run', 'all']).optional().default('parent_run').describe('Scope for list action.'),
});

type AgentManageArgs = z.infer<typeof AgentManageSchema>;

function isTempAgentRole(roleName: string): boolean {
  return roleName.startsWith('@delegate/');
}

function isTempAgentMember(member: { roleName: string; name: string }): boolean {
  return isTempAgentRole(member.roleName) || member.name.startsWith('delegate:');
}

function getActiveAgents(repo: ToolExecutionContext['repo'], organizationId: string) {
  return repo.listMembers(organizationId)
    .filter((member) => member.kind === AGENT_KIND && !member.retiredAt);
}

function findActiveAgent(repo: ToolExecutionContext['repo'], organizationId: string, query: string) {
  return getActiveAgents(repo, organizationId)
    .find((member) => member.id === query || member.name === query);
}

async function executeAgentManage(ctx: ToolExecutionContext, args: AgentManageArgs): Promise<unknown> {
  const orgId = ctx.invocation.organizationId;

  switch (args.action) {
    // ── search_catalog ──────────────────────────────────────────────
    case 'search_catalog': {
      const query = args.query?.toLowerCase() ?? '';
      const activeAgents = getActiveAgents(ctx.repo, orgId);

      // Filter temp agents and permanent agents
      const permanentAgents = activeAgents.filter((a) => !isTempAgentMember(a));

      const results = query
        ? permanentAgents.filter(
            (a) =>
              a.name.toLowerCase().includes(query) ||
              a.id.toLowerCase().includes(query) ||
              a.roleName.toLowerCase().includes(query),
          )
        : permanentAgents;

      return {
        results: results.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.roleName,
          kind: 'agent',
          source: 'member',
        })),
        total: results.length,
      };
    }

    // ── create ──────────────────────────────────────────────────────
    case 'create': {
      if (!args.source) throw new Error('create action requires a source (agent name or id).');

      // Check if the source agent exists and is active.
      const sourceAgent = findActiveAgent(ctx.repo, orgId, args.source);
      if (!sourceAgent) {
        throw new Error(`Source agent "${args.source}" not found or is retired.`);
      }
      if (sourceAgent.id === ctx.invocation.memberId) {
        throw new Error('Cannot create a delegate of yourself.');
      }

      // Spawn a temp agent member with a @delegate/ roleName so the
      // system recognises it as ephemeral and auto-retires on completion.
      const now = new Date().toISOString();
      const agentId = randomUUID();
      const mode = args.mode ?? 'worker';
      const agentName = `delegate:${mode}:${sourceAgent.name}-${agentId.slice(0, 8)}`;

      ctx.repo.saveMember({
        id: agentId,
        organizationId: orgId,
        name: agentName,
        kind: AGENT_KIND as 'agent',
        roleName: sourceAgent.roleName,
        llm: sourceAgent.llm,
        model: sourceAgent.model,
        presence: 'online',
        createdAt: now,
      });

      // Resolve caller name for the thread title.
      const caller = ctx.repo.getMember(orgId, ctx.invocation.memberId);
      const callerName = caller?.name ?? ctx.invocation.memberId;

      // Create a DM thread between the caller and the new temp agent.
      const threadId = getDirectMessageThreadId(ctx.invocation.memberId, agentId);
      ctx.repo.ensureThread({
        id: threadId,
        organizationId: orgId,
        channelId: threadId,
        title: `${callerName} → ${agentName}`,
        memberIds: [ctx.invocation.memberId, agentId],
        createdAt: now,
      });

      return {
        agent_id: agentId,
        name: agentName,
        source: sourceAgent.name,
        mode,
        thread_id: threadId,
        config: args.config ?? {},
        message: `Temp agent "${agentName}" created in ${mode} mode. Retire with agent.manage retire agent_id="${agentId}" when done.`,
      };
    }

    // ── list ────────────────────────────────────────────────────────
    case 'list': {
      const allMembers = ctx.repo.listMembers(orgId);
      const tempAgents = allMembers.filter(
        (m) => m.kind === AGENT_KIND && isTempAgentMember(m),
      );

      return {
        agents: tempAgents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.roleName,
          status: a.retiredAt ? 'retired' : 'active',
          createdAt: a.createdAt,
          retiredAt: a.retiredAt,
        })),
        scope: args.scope,
        total: tempAgents.length,
      };
    }

    // ── inspect ─────────────────────────────────────────────────────
    case 'inspect': {
      if (!args.agent_id) throw new Error('inspect action requires agent_id.');
      const agent = ctx.repo.getMember(orgId, args.agent_id);
      if (!agent) throw new Error(`Agent "${args.agent_id}" not found.`);

      // Find any active runs for this agent.
      const activeRuns = ctx.repo.listActiveRuns(orgId)
        .filter((r) => r.agentId === agent.id);

      const isTemp = isTempAgentMember(agent);

      return {
        agent_id: agent.id,
        name: agent.name,
        role: agent.roleName,
        kind: agent.kind,
        llm: agent.llm ?? null,
        model: agent.model ?? null,
        isTempAgent: isTemp,
        status: agent.retiredAt ? 'retired' : 'active',
        createdAt: agent.createdAt,
        retiredAt: agent.retiredAt ?? null,
        activeRuns: activeRuns.map((r) => ({
          id: r.id,
          threadId: r.threadId,
          status: r.status,
          step: r.step,
        })),
        activeRunCount: activeRuns.length,
      };
    }

    // ── retire ──────────────────────────────────────────────────────
    case 'retire': {
      if (!args.agent_id) throw new Error('retire action requires agent_id.');
      const agent = ctx.repo.getMember(orgId, args.agent_id);
      if (!agent) throw new Error(`Agent "${args.agent_id}" not found.`);
      if (agent.retiredAt) {
        return { agent_id: args.agent_id, retired: true, message: 'Agent was already retired.' };
      }
      ctx.repo.saveMember({ ...agent, retiredAt: new Date().toISOString() });
      return { agent_id: args.agent_id, retired: true, message: `Agent "${agent.name}" retired.` };
    }

    // ── kill ────────────────────────────────────────────────────────
    case 'kill': {
      if (!args.agent_id) throw new Error('kill action requires agent_id.');
      const agent = ctx.repo.getMember(orgId, args.agent_id);
      if (!agent) throw new Error(`Agent "${args.agent_id}" not found.`);

      // Cancel any active runs for this agent.
      const activeRuns = ctx.repo.listActiveRuns(orgId)
        .filter((r) => r.agentId === agent.id);
      let stoppedCount = 0;
      for (const run of activeRuns) {
        ctx.repo.saveRun?.({
          ...run,
          status: 'cancelled',
          summary: (run.summary ?? '') + ' [killed by agent.manage]',
          endedAt: new Date().toISOString(),
        });
        stoppedCount++;
      }

      // Retire the agent.
      if (!agent.retiredAt) {
        ctx.repo.saveMember({ ...agent, retiredAt: new Date().toISOString() });
      }

      return {
        agent_id: args.agent_id,
        name: agent.name,
        stopped: true,
        runsCancelled: stoppedCount,
        message: `Agent "${agent.name}" killed. ${stoppedCount} run(s) cancelled.`,
      };
    }

    default: {
      const _exhaustive: never = args.action;
      throw new Error(`Unknown agent.manage action: ${_exhaustive}`);
    }
  }
}

export const agentManageTool: OrchestratorTool<typeof AgentManageSchema> = {
  id: 'agent.manage',
  schema: AgentManageSchema,
  toInvocation: (args) => ({
    action: 'execute',
    resourceType: 'mcp',
    input: args as unknown as Record<string, unknown>,
  }),
  execute: (ctx) => {
    const args = ctx.invocation.input as unknown as AgentManageArgs;
    return executeAgentManage(ctx, args);
  },
};
