import type { ModelMessage, ToolSet } from 'ai';

export const DELEGATE_KINDS = ['worker', 'explorer'] as const;
export type DelegateKind = (typeof DELEGATE_KINDS)[number];

const EXPLORER_DELEGATE_TOOL_IDS = new Set([
  'channel.read',
  'channel.list',
  'channel.recall',
  'view',
  'ls',
  'glob',
  'grep',
  'fetch',
  'web_search',
  'memory.recall',
  'self.procedure.view',
  'procedure.view',
]);

const WORKER_BLOCKED_TOOL_IDS = new Set([
  'channel.post',
  'channel.reply',
  'channel.dm',
  'channel.handoff',
  'channel.pass',
  'channel.ack',
  'message',
  'agent.delegate',
]);

const DELEGATE_KIND_MESSAGES: Record<DelegateKind, string> = {
  worker: '<delegate_kind>\nkind=worker\nYou may use edit/write tools if needed, but still do not post or hand off.\n</delegate_kind>',
  explorer: '<delegate_kind>\nkind=explorer\nYou are read-only. Use read tools only. No edit, write, or shell tools.\n</delegate_kind>',
};

export const DELEGATE_TURN_USER_MESSAGE = [
  '<delegate_turn>',
  'You are a subagent handling one bounded agent.delegate task. Stay narrow, do the job directly, and use the fewest tools needed.',
  'Do not delegate again.',
  'Do not call channel.post, channel.reply, channel.dm, message, channel.pass, channel.ack, or channel.handoff.',
  'Return only final assistant text. No preamble, no explanation, no extra formatting.',
  '</delegate_turn>',
].join('\n');

export function getDelegateKind(message: { metadata?: unknown } | null | undefined): DelegateKind {
  const kind = (message?.metadata as { delegate?: { kind?: unknown } } | undefined)?.delegate?.kind;
  return kind === 'explorer' ? 'explorer' : 'worker';
}

export function buildDelegateTurnKindMessage(kind: DelegateKind): ModelMessage {
  return { role: 'user', content: DELEGATE_KIND_MESSAGES[kind] };
}

export function buildDelegateTurnContextMessages(kind: DelegateKind): ModelMessage[] {
  return [
    { role: 'user', content: DELEGATE_TURN_USER_MESSAGE },
    buildDelegateTurnKindMessage(kind),
  ];
}

function normalizeToDottedToolName(name: string): string {
  return name.replace(/_/g, '.');
}

export function filterDelegateTurnToolSet(toolSet: ToolSet, kind: DelegateKind = 'worker'): ToolSet {
  return Object.fromEntries(
    Object.entries(toolSet).filter(([toolId]) => {
      const dotted = normalizeToDottedToolName(toolId);
      return kind === 'explorer'
        ? EXPLORER_DELEGATE_TOOL_IDS.has(toolId) || EXPLORER_DELEGATE_TOOL_IDS.has(dotted)
        : !WORKER_BLOCKED_TOOL_IDS.has(toolId) && !WORKER_BLOCKED_TOOL_IDS.has(dotted);
    }),
  ) as ToolSet;
}
