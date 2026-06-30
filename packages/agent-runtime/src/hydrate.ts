import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
import {
  buildCollaborationProtocol,
  buildEnvironmentContext,
  buildTeamHierarchySection,
  SHARED_AGENT_SYSTEM_PROMPT,
} from '@ujima/shared';
import type { ContextEntry, ContextStore, ApprovalTracker } from '@ujima/context-store';
import type { EventBus } from '@ujima/event-bus';
import type { HydrationBundle } from './types';

export interface HydrateDeps {
  agent: AgentDef;
  task: TaskDef;
  context: ContextStore;
  eventBus: EventBus;
  approvals?: ApprovalTracker;
  eventLookbackMs?: number;
  maxPeerEntries?: number;
  maxEvents?: number;
  /** Session ID for this run, so the agent can reference it in context keys. */
  sessionId?: string;
  /** Other agents on the same team — gives the agent social awareness. */
  teammates?: AgentDef[];
  /** Name & description of the MCP the agent is connected to. */
  mcpMeta?: { name: string; description?: string };
  /** Operational constraints the agent should be aware of. */
  constraints?: {
    maxToolIterations?: number;
    maxSessionTokens?: number;
  };
}

const DEFAULT_LOOKBACK_MS = 15 * 60 * 1000;
const DEFAULT_MAX_PEER_ENTRIES = 20;
const DEFAULT_MAX_EVENTS = 50;

export async function hydrate(deps: HydrateDeps): Promise<HydrationBundle> {
  const {
    agent,
    task,
    context,
    eventBus,
    approvals,
    eventLookbackMs = DEFAULT_LOOKBACK_MS,
    maxPeerEntries = DEFAULT_MAX_PEER_ENTRIES,
    maxEvents = DEFAULT_MAX_EVENTS,
  } = deps;

  const since = Date.now() - eventLookbackMs;

  const subscribedChannels = agent.communication.subscribes;
  const eventLists = await Promise.all(
    subscribedChannels.map((ch) => eventBus.replay(ch, since)),
  );
  const events = mergeEvents(eventLists, maxEvents);

  const peerOutputs: ContextEntry[] = [];
  for (const channel of subscribedChannels) {
    const prefix = channelToContextPrefix(channel, task.task_id);
    const entries = await context.list(prefix);
    for (const e of entries) {
      peerOutputs.push(e);
      if (peerOutputs.length >= maxPeerEntries) break;
    }
    if (peerOutputs.length >= maxPeerEntries) break;
  }

  const approvedArtifacts: ContextEntry[] = [];
  if (approvals) {
    const domains = collectDomains(agent);
    for (const domain of domains) {
      const records = await approvals.listApprovedByDomain(task.task_id, domain);
      for (const r of records) {
        const entry = await context.get(r.artifact_key);
        if (entry !== undefined) {
          approvedArtifacts.push({
            key: r.artifact_key,
            value: entry,
            updatedAt: r.decided_at ?? r.created_at,
          });
        }
      }
    }
  }

  const eventsBlock = events.length > 0
    ? [
        `## Recent events (${events.length})`,
        ...events.map((e) =>
          `- [${e.timestamp}] ${e.type} from ${e.publisher}: ${truncate(JSON.stringify(e.payload), 200)}`
        ),
      ].join('\n')
    : undefined;

  return {
    persona: agent.persona,
    taskPrompt: buildTaskPrompt(task, deps.sessionId),
    events,
    peerOutputs,
    approvedArtifacts,
    systemPrompt: buildSystemPrompt({
      agent,
      peerOutputs,
      approvedArtifacts,
      teammates: deps.teammates,
      mcpMeta: deps.mcpMeta,
      constraints: deps.constraints,
    }),
    eventsBlock,
  };
}

function mergeEvents(lists: UjimaEvent[][], max: number): UjimaEvent[] {
  const flat = lists.flat();
  flat.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return flat.slice(-max);
}

function channelToContextPrefix(channel: string, taskId: string): string {
  return `task:${taskId}:${channel}`;
}

function collectDomains(agent: AgentDef): string[] {
  const s = new Set<string>();
  for (const c of agent.communication.subscribes) {
    const head = c.split(':')[0];
    if (head) s.add(head);
  }
  if (agent.reviews) {
    for (const r of agent.reviews) s.add(r);
  }
  return [...s];
}

function buildSystemPrompt(opts: {
  agent: AgentDef;
  peerOutputs: ContextEntry[];
  approvedArtifacts: ContextEntry[];
  teammates?: AgentDef[];
  mcpMeta?: { name: string; description?: string };
  constraints?: {
    maxToolIterations?: number;
    maxSessionTokens?: number;
  };
}): string {
  const { agent, peerOutputs, approvedArtifacts, teammates, mcpMeta, constraints } = opts;
  const sections: string[] = [];

  sections.push(`You are "${agent.name}" (agent id: ${agent.id}).`);

  // ── Shared soul: universal behavioral rules ──
  sections.push(SHARED_AGENT_SYSTEM_PROMPT);

  // ── Environment: temporal, spatial, and system grounding ──
  sections.push(`\n${buildEnvironmentContext()}`);

  // ── Identity: who the agent is and where it sits ──
  sections.push(`\n## Persona\n${agent.persona.trim()}`);

  if (agent.seniority || agent.reports_to) {
    const identityLines = [`\n## Role`];
    if (agent.seniority) identityLines.push(`- Seniority: ${agent.seniority}`);
    if (agent.reports_to) identityLines.push(`- Reports to: ${agent.reports_to}`);
    if (agent.reviews && agent.reviews.length > 0) {
      identityLines.push(`- You review work in: ${agent.reviews.join(', ')}`);
    }
    sections.push(identityLines.join('\n'));
  }

  // ── Team: who the agent works with (hierarchical org chart) ──
  if (teammates && teammates.length > 0) {
    sections.push(buildTeamHierarchySection(teammates));
  }

  // ── Collaboration protocol: how to work with teammates ──
  sections.push(`\n${buildCollaborationProtocol('channel')}`);

  // ── Tooling: what the agent has access to ──
  if (mcpMeta) {
    const toolLines = [`\n## Tooling`];
    toolLines.push(`- Connected to MCP: **${mcpMeta.name}**`);
    if (mcpMeta.description) toolLines.push(`  ${mcpMeta.description}`);
    sections.push(toolLines.join('\n'));
  }

  // ── Workspace scopes: where the agent is allowed to operate ──
  if (agent.workspace_scopes && agent.workspace_scopes.length > 0) {
    sections.push(
      `\n## Workspace Scopes\nYou have access to the following paths:\n${agent.workspace_scopes.map((s) => `- ${s}`).join('\n')}`,
    );
  }

  // ── Constraints: operational limits ──
  if (constraints) {
    const cLines = [`\n## Operational Constraints`];
    if (constraints.maxToolIterations) {
      cLines.push(`- Max tool iterations: ${constraints.maxToolIterations} — plan your work to finish within this budget`);
    }
    if (constraints.maxSessionTokens) {
      cLines.push(`- Token budget: ${constraints.maxSessionTokens.toLocaleString()} tokens`);
    }
    sections.push(cLines.join('\n'));
  }

  if (approvedArtifacts.length > 0) {
    sections.push(`\n## Approved artifacts (${approvedArtifacts.length})`);
    for (const a of approvedArtifacts) {
      sections.push(`- ${a.key}: ${truncate(JSON.stringify(a.value), 400)}`);
    }
  }

  if (peerOutputs.length > 0) {
    sections.push(`\n## Peer outputs (${peerOutputs.length})`);
    for (const p of peerOutputs) {
      sections.push(`- ${p.key}: ${truncate(JSON.stringify(p.value), 400)}`);
    }
  }

  if (agent.communication.publishes.length > 0) {
    sections.push(
      `\n## Output channels\nYou publish to: ${agent.communication.publishes.join(', ')}. ` +
        `Write structured outputs via the context store when a tool allows.`,
    );
  }

  if (agent.escalation.conditions.length > 0) {
    sections.push(
      `\n## Escalation\nIf any of these conditions occur, stop and explain clearly: ${agent.escalation.conditions.join('; ')}. ` +
        `Escalate to: ${agent.escalation.escalate_to}.`,
    );
  }

  return sections.join('\n');
}

function buildTaskPrompt(task: TaskDef, sessionId?: string): string {
  const lines = [`## Task`];
  if (task.task_id || sessionId) {
    const ids: string[] = [];
    if (task.task_id) ids.push(`task_id: ${task.task_id}`);
    if (sessionId) ids.push(`session_id: ${sessionId}`);
    lines.push(`_${ids.join(' | ')}_`);
  }
  lines.push(task.prompt);
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
