/**
 * Single source of truth for every tool in the system.
 *
 * ADDING A TOOL:    add one entry below. All derived lists update automatically.
 * REMOVING A TOOL:  flip its `status` to `'removed'`. The migration/runtime
 *                   filtering pick it up mechanically — zero file hunting.
 * RENAMING A TOOL:  add the new entry as `'active'`, flip the old entry to
 *                   `'deprecated'` with `alias` pointing to the new id.
 *
 * Never edit the derived exports — they are pure computations over TOOL_REGISTRY.
 */
// ---------------------------------------------------------------------------

export interface ToolEntry {
  /** Canonical tool id as used in ORCHESTRATOR_TOOLS and role.tools arrays. */
  id: string;
  /** `active` = usable. `deprecated` = aliased to another tool. `removed` = stripped. */
  status: 'active' | 'deprecated' | 'removed';
  /** When status is `deprecated`, the replacement tool id. */
  alias?: string;
  /** Included in ALWAYS_AVAILABLE_AGENT_TOOLS (baseline palette). */
  alwaysAvailable?: boolean;
  /** Allowed for supervisor turns. */
  supervisorAllowed?: boolean;
  /** Available to explorer delegates (read-only sub-agents). */
  explorerDelegate?: boolean;
  /** Blocked for worker delegates (sub-agents can't post/handoff). */
  workerBlocked?: boolean;
}

// ── Registry ──────────────────────────────────────────────────────

export const TOOL_REGISTRY: Record<string, ToolEntry> = {
  // ── Procedure ─────────────────────────────────────────────
  procedure: {
    id: 'procedure',
    status: 'active',
    alwaysAvailable: true,
    supervisorAllowed: true,
    explorerDelegate: true,
  },
  'self.procedure.add':   { id: 'self.procedure.add',   status: 'deprecated', alias: 'procedure' },
  'self.procedure.remove':{ id: 'self.procedure.remove',status: 'deprecated', alias: 'procedure' },
  'self.procedure.list':  { id: 'self.procedure.list',  status: 'deprecated', alias: 'procedure' },
  'self.procedure.view':  { id: 'self.procedure.view',  status: 'deprecated', alias: 'procedure' },
  'procedure.list':       { id: 'procedure.list',       status: 'deprecated', alias: 'procedure' },
  'procedure.view':       { id: 'procedure.view',       status: 'deprecated', alias: 'procedure' },

  // ── Channel ───────────────────────────────────────────────
  'channel.pass': {
    id: 'channel.pass', status: 'active', alwaysAvailable: true, supervisorAllowed: true, workerBlocked: true,
  },
  'channel.ack': {
    id: 'channel.ack', status: 'active', alwaysAvailable: true, workerBlocked: true,
  },
  'channel.reply': {
    id: 'channel.reply', status: 'active', alwaysAvailable: true, supervisorAllowed: true, workerBlocked: true,
  },
  'channel.post': {
    id: 'channel.post', status: 'active', alwaysAvailable: true, supervisorAllowed: true, workerBlocked: true,
  },
  'channel.dm': {
    id: 'channel.dm', status: 'active', alwaysAvailable: true, supervisorAllowed: true, workerBlocked: true,
  },
  'channel.recall': {
    id: 'channel.recall', status: 'active', alwaysAvailable: true, explorerDelegate: true,
  },
  'channel.read': {
    id: 'channel.read', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true,
  },
  'channel.list': {
    id: 'channel.list', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true,
  },
  'channel.handoff': {
    id: 'channel.handoff', status: 'active', supervisorAllowed: true, workerBlocked: true,
  },
  'channel.set_member_mode': {
    id: 'channel.set_member_mode', status: 'active',
  },

  // ── Workspace — read ──────────────────────────────────────
  view: { id: 'view', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },
  ls:   { id: 'ls',   status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },
  glob: { id: 'glob', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },
  grep: { id: 'grep', status: 'active', alwaysAvailable: true, explorerDelegate: true },

  // ── Workspace — write ─────────────────────────────────────
  write:     { id: 'write',     status: 'active', alwaysAvailable: true },
  edit:      { id: 'edit',      status: 'active', alwaysAvailable: true },
  multiedit: { id: 'multiedit', status: 'active', alwaysAvailable: true },
  shell:     { id: 'shell',     status: 'active', alwaysAvailable: true },
  download:  { id: 'download',  status: 'active', alwaysAvailable: true },

  // ── Web / fetch ───────────────────────────────────────────
  fetch:      { id: 'fetch',      status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },
  web_search: { id: 'web_search', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },

  // ── Goals / questions ─────────────────────────────────────
  'goal.start':       { id: 'goal.start',       status: 'active', alwaysAvailable: true, supervisorAllowed: true },
  'goal.task.update': { id: 'goal.task.update', status: 'active', alwaysAvailable: true, supervisorAllowed: true },
  'question.ask':    { id: 'question.ask',    status: 'active', alwaysAvailable: true, supervisorAllowed: true },

  // ── Memory ────────────────────────────────────────────────
  'memory.write':  { id: 'memory.write',  status: 'active', alwaysAvailable: true, supervisorAllowed: true },
  'memory.recall': { id: 'memory.recall', status: 'active', alwaysAvailable: true, supervisorAllowed: true, explorerDelegate: true },
  'memory.forget': { id: 'memory.forget', status: 'active', alwaysAvailable: true },
  'memory.save':   { id: 'memory.save',   status: 'deprecated', alias: 'memory.write' },

  // ── Scheduling / delegation ───────────────────────────────
  schedule:         { id: 'schedule',         status: 'active', alwaysAvailable: true },
  'agent.delegate': { id: 'agent.delegate',   status: 'active', alwaysAvailable: true, workerBlocked: true },

  // ── Skills ────────────────────────────────────────────────
  'skill.read': { id: 'skill.read', status: 'active', alwaysAvailable: true },

  // ── Removed ───────────────────────────────────────────────
  message:    { id: 'message',    status: 'removed' },
  'self.note':{ id: 'self.note',  status: 'removed' },
  filesystem: { id: 'filesystem', status: 'removed' },
  job_output: { id: 'job_output', status: 'removed' },
  job_kill:   { id: 'job_kill',   status: 'removed' },
} as const;

// ── Derived exports — compute, never edit ─────────────────────────

const R: Record<string, ToolEntry> = TOOL_REGISTRY;

export const DEPRECATED_TOOL_ALIASES: Record<string, string> = Object.freeze(
  Object.fromEntries(
    Object.entries(R)
      .filter(([, entry]) => entry.status === 'deprecated' && entry.alias)
      .map(([id, entry]) => [id, entry.alias!]),
  ),
) as Record<string, string>;

export const REMOVED_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.keys(R).filter((id) => R[id]!.status === 'removed'),
);

export const ALWAYS_AVAILABLE_AGENT_TOOLS: readonly string[] = Object.freeze(
  Object.keys(R).filter((id) => R[id]!.alwaysAvailable),
);

export const SUPERVISOR_TOOL_ALLOWLIST: readonly string[] = Object.freeze(
  Object.keys(R).filter((id) => R[id]!.supervisorAllowed),
);

export const EXPLORER_DELEGATE_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.keys(R).filter((id) => R[id]!.explorerDelegate),
);

export const WORKER_BLOCKED_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.keys(R).filter((id) => R[id]!.workerBlocked),
);

export function filterDeprecatedToolIds(toolIds: readonly string[]): string[] {
  const normalized = toolIds.map((toolId) => {
    if (REMOVED_TOOL_IDS.has(toolId)) return null;
    return (DEPRECATED_TOOL_ALIASES as Record<string, string>)[toolId] ?? toolId;
  });
  return [...new Set(normalized.filter((toolId): toolId is string => toolId !== null))];
}
