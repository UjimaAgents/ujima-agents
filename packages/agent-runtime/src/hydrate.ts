import type { AgentDef, TaskDef, UjimaEvent } from '@ujima/shared';
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

  return {
    persona: agent.persona,
    taskPrompt: task.prompt,
    events,
    peerOutputs,
    approvedArtifacts,
    systemPrompt: buildSystemPrompt({
      agent,
      task,
      events,
      peerOutputs,
      approvedArtifacts,
    }),
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
  task: TaskDef;
  events: UjimaEvent[];
  peerOutputs: ContextEntry[];
  approvedArtifacts: ContextEntry[];
}): string {
  const { agent, task, events, peerOutputs, approvedArtifacts } = opts;
  const sections: string[] = [];

  sections.push(`You are "${agent.name}" (agent id: ${agent.id}).`);
  sections.push(agent.persona.trim());

  sections.push(`\n## Task\n${task.prompt}`);

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

  if (events.length > 0) {
    sections.push(`\n## Recent events (${events.length})`);
    for (const e of events) {
      sections.push(`- [${e.timestamp}] ${e.type} from ${e.publisher}: ${truncate(JSON.stringify(e.payload), 200)}`);
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
