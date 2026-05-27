import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Procedures-as-Culture substrate (docs/procedures-as-culture.md).
 *
 * Same primitive — markdown file + YAML frontmatter — at three scopes:
 *
 *   org      → ai/memory-bank/org/procedures/<slug>.md
 *   channel  → ai/memory-bank/channels/<channel-id>/procedures/<slug>.md
 *   agent    → ai/memory-bank/agents/<member-id>/procedures/<slug>.md   (Bet 7)
 *
 * The agent-scope file layout is unchanged so existing `self.procedure.*`
 * stays working. Org and channel are NEW and human-curated through the
 * HTTP API; agents only ever write to their own subtree.
 *
 * Aggregator returns three rendered sections (workspace culture +
 * channel culture + own procedures) plus LAW entries (org `enforced:
 * true`) hoisted to the top of Zone 1. Bodies are NOT included — only
 * `name: description` one-liners. The agent calls `procedure.view`
 * to read a body on demand. Hard cap per layer prevents prompt bloat.
 */

export type ProcedureScope = 'org' | 'channel' | 'agent';

export interface ProcedureFile {
  scope: ProcedureScope;
  /** '' for org; channel-id for channel; member-id for agent. */
  scopeId: string;
  name: string;
  description: string;
  body: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  /** Only ever true on org-scope entries. LAW (do not violate). */
  enforced: boolean;
  /** Absolute on-disk path. */
  path: string;
}

export interface ProcedureApplied {
  scope: ProcedureScope;
  scopeId: string;
  name: string;
  version: number;
  enforced: boolean;
}

export interface AggregatorOutput {
  /** Rendered LAW lines (org `enforced: true`) — go at top of Zone 1. */
  lawText?: string;
  /** Rendered three-scope culture section (cache-stable Zone 1). */
  cultureText?: string;
  /** What got surfaced this wake; written to telemetry. */
  applied: ProcedureApplied[];
}

const PROCEDURE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const HARD_LIST_CAP = 50;
const ORG_BUDGET_BYTES = 750;
const CHANNEL_BUDGET_BYTES = 750;
const AGENT_BUDGET_BYTES = 500;
const LAW_HARD_CAP = 3;

export const PROCEDURE_BUDGETS = Object.freeze({
  org: ORG_BUDGET_BYTES,
  channel: CHANNEL_BUDGET_BYTES,
  agent: AGENT_BUDGET_BYTES,
});

export function isValidProcedureName(name: string): boolean {
  return PROCEDURE_NAME_PATTERN.test(name);
}

export function safeSegment(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'unknown';
}

export function proceduresDirFor(
  workspaceRoot: string,
  scope: ProcedureScope,
  scopeId: string,
): string {
  switch (scope) {
    case 'org':
      return join(workspaceRoot, 'ai', 'memory-bank', 'org', 'procedures');
    case 'channel':
      return join(
        workspaceRoot,
        'ai',
        'memory-bank',
        'channels',
        safeSegment(scopeId),
        'procedures',
      );
    case 'agent':
      return join(
        workspaceRoot,
        'ai',
        'memory-bank',
        'agents',
        safeSegment(scopeId),
        'procedures',
      );
  }
}

function procedureFilePath(
  workspaceRoot: string,
  scope: ProcedureScope,
  scopeId: string,
  name: string,
): string {
  return join(proceduresDirFor(workspaceRoot, scope, scopeId), `${name}.md`);
}

/**
 * Detect whether a workspace-relative path falls under ANY procedures
 * directory. Used by:
 *   - the FTS indexer (skip procedures so they don't surface in
 *     `channel.recall(scope: 'files')`) — they are a system of record,
 *     not a recall artifact.
 *   - the path-prefix guard on agent writes (procedures live under
 *     `ai/memory-bank/{org,channels,agents/<not-self>}/procedures/`
 *     and only specific tools can write them).
 *
 * Accepts both POSIX and Windows-style separators.
 */
export function isProceduresPath(filePath: string): boolean {
  const normalized = filePath.split(/[\\/]+/).filter(Boolean);
  if (normalized.length < 4) return false;
  // Looking for ai/memory-bank/{org|channels|agents}/.../procedures/...
  const aiIdx = normalized.indexOf('ai');
  if (aiIdx < 0) return false;
  if (normalized[aiIdx + 1] !== 'memory-bank') return false;
  const scopeRoot = normalized[aiIdx + 2];
  if (scopeRoot !== 'org' && scopeRoot !== 'channels' && scopeRoot !== 'agents') return false;
  return normalized.includes('procedures', aiIdx + 3);
}

/**
 * Return true when an agent (memberId) is about to write a path it
 * shouldn't. The doc says agents may only write inside their own
 * `ai/memory-bank/agents/<self>/**` subtree — never to org culture,
 * channel culture, or another agent's procedures.
 *
 * Returns `false` (allowed) for paths outside the memory-bank entirely
 * — only the protected subtree is guarded here.
 */
export function isAgentRestrictedProcedurePath(memberId: string, filePath: string): boolean {
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  const aiIdx = parts.indexOf('ai');
  if (aiIdx < 0 || parts[aiIdx + 1] !== 'memory-bank') return false;
  const scopeRoot = parts[aiIdx + 2];
  if (scopeRoot === 'org' || scopeRoot === 'channels') return true;
  if (scopeRoot === 'agents') {
    const ownerSegment = parts[aiIdx + 3];
    if (!ownerSegment) return false;
    return ownerSegment !== safeSegment(memberId);
  }
  return false;
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const fence = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fence) return { meta: {}, body: raw.trim() };
  const block = fence[1] ?? '';
  const body = (fence[2] ?? '').trim();
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m && typeof m[1] === 'string' && typeof m[2] === 'string') {
      meta[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
  return { meta, body };
}

export function renderProcedureFile(file: ProcedureFile): string {
  // Write-time normalisation: CRLF → LF, strip trailing whitespace per
  // line. Cache-stability lint relies on this — an editor-induced
  // byte change in the body silently busts the prefix cache otherwise.
  const normalizedBody = file.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
  const lines = [
    '---',
    `name: ${file.name}`,
    `description: ${file.description.replace(/\n+/g, ' ')}`,
    `created_at: ${file.createdAt}`,
    `created_by: ${file.createdBy}`,
    `updated_at: ${file.updatedAt}`,
    `updated_by: ${file.updatedBy}`,
    `version: ${file.version}`,
  ];
  if (file.scope === 'org' && file.enforced) {
    lines.push('enforced: true');
  }
  lines.push('---', '', normalizedBody, '');
  return lines.join('\n');
}

export async function listProceduresByScope(
  workspaceRoot: string,
  scope: ProcedureScope,
  scopeId: string,
): Promise<ProcedureFile[]> {
  const dir = proceduresDirFor(workspaceRoot, scope, scopeId);
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  const out: ProcedureFile[] = [];
  for (const file of names) {
    const path = join(dir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseFrontmatter(raw);
      const name = parsed.meta['name'] ?? file.replace(/\.md$/, '');
      if (!name) continue;
      const description = parsed.meta['description'] ?? '';
      const createdAt = parsed.meta['created_at'] ?? '1970-01-01T00:00:00Z';
      const createdBy = parsed.meta['created_by'] ?? 'unknown';
      const updatedAt = parsed.meta['updated_at'] ?? createdAt;
      const updatedBy = parsed.meta['updated_by'] ?? createdBy;
      const versionRaw = parsed.meta['version'] ?? '1';
      const version = Number.parseInt(versionRaw, 10) || 1;
      const enforced = scope === 'org' && parsed.meta['enforced']?.toLowerCase() === 'true';
      out.push({
        scope,
        scopeId,
        name,
        description,
        body: parsed.body,
        createdAt,
        createdBy,
        updatedAt,
        updatedBy,
        version,
        enforced,
        path,
      });
    } catch {
      // skip unreadable
    }
  }
  // Sort by name (NOT createdAt) so reorders never bust the prefix
  // cache — per docs/procedures-as-culture.md "Zone 1 ordering".
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out.slice(0, HARD_LIST_CAP);
}

export interface SaveProcedureInput {
  workspaceRoot: string;
  scope: ProcedureScope;
  scopeId: string;
  name: string;
  description: string;
  body: string;
  enforced?: boolean;
  /** Identifier of who is saving — human user id, or `self.<agent-id>`. */
  actor: string;
}

export async function saveProcedure(input: SaveProcedureInput): Promise<ProcedureFile> {
  if (!isValidProcedureName(input.name)) {
    throw new Error(`invalid procedure name "${input.name}"`);
  }
  if (input.enforced && input.scope !== 'org') {
    throw new Error('enforced=true is only valid on org-scope procedures');
  }
  const dir = proceduresDirFor(input.workspaceRoot, input.scope, input.scopeId);
  await mkdir(dir, { recursive: true });
  const path = procedureFilePath(input.workspaceRoot, input.scope, input.scopeId, input.name);
  const now = new Date().toISOString();

  // If the file exists, bump version and preserve createdAt/createdBy.
  let existing: ProcedureFile | null = null;
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = parseFrontmatter(raw);
      existing = {
        scope: input.scope,
        scopeId: input.scopeId,
        name: input.name,
        description: parsed.meta['description'] ?? '',
        body: parsed.body,
        createdAt: parsed.meta['created_at'] ?? now,
        createdBy: parsed.meta['created_by'] ?? input.actor,
        updatedAt: parsed.meta['updated_at'] ?? now,
        updatedBy: parsed.meta['updated_by'] ?? input.actor,
        version: Number.parseInt(parsed.meta['version'] ?? '1', 10) || 1,
        enforced: input.scope === 'org' && parsed.meta['enforced']?.toLowerCase() === 'true',
        path,
      };
    } catch {
      existing = null;
    }
  }

  if (input.scope === 'org' && input.enforced) {
    // Cap LAW entries at 3 per org. Reserved for safety lines.
    const all = await listProceduresByScope(input.workspaceRoot, 'org', '');
    const otherLaws = all.filter((p) => p.enforced && p.name !== input.name);
    if (otherLaws.length >= LAW_HARD_CAP) {
      throw new Error(
        `cannot mark "${input.name}" as enforced — org already has ${otherLaws.length} LAW entries (max ${LAW_HARD_CAP}).`,
      );
    }
  }

  const file: ProcedureFile = {
    scope: input.scope,
    scopeId: input.scopeId,
    name: input.name,
    description: input.description,
    body: input.body,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? input.actor,
    updatedAt: now,
    updatedBy: input.actor,
    version: existing ? existing.version + 1 : 1,
    enforced: input.scope === 'org' ? Boolean(input.enforced) : false,
    path,
  };
  await writeFile(path, renderProcedureFile(file), 'utf8');
  return file;
}

export async function removeProcedure(
  workspaceRoot: string,
  scope: ProcedureScope,
  scopeId: string,
  name: string,
): Promise<boolean> {
  const path = procedureFilePath(workspaceRoot, scope, scopeId, name);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}

function fitWithinBudget(items: ProcedureFile[], budgetBytes: number): ProcedureFile[] {
  const fitted: ProcedureFile[] = [];
  let used = 0;
  for (const item of items) {
    const line = `- ${item.name}: ${item.description}\n`;
    const size = Buffer.byteLength(line, 'utf8');
    if (used + size > budgetBytes) break;
    fitted.push(item);
    used += size;
  }
  return fitted;
}

/**
 * Multi-scope wake-time aggregator. Loads org + channel + agent
 * procedures and renders three blocks. Bodies are NEVER included —
 * only `- name: description` one-liners. Bodies load on demand via
 * `procedure.view(name)`.
 *
 * LAW entries (org `enforced: true`) are pulled out separately so
 * the caller can render them at the top of Zone 1 above the other
 * procedures. They are also still included in the workspace-culture
 * section so the agent sees them in their original location.
 */
export async function aggregateProcedures(input: {
  workspaceRoot: string;
  organizationId: string;
  memberId: string;
  channelId?: string;
}): Promise<AggregatorOutput> {
  const orgEntries = await listProceduresByScope(input.workspaceRoot, 'org', '');
  const channelEntries = input.channelId
    ? await listProceduresByScope(input.workspaceRoot, 'channel', input.channelId)
    : [];
  const agentEntries = await listProceduresByScope(input.workspaceRoot, 'agent', input.memberId);

  const fittedOrg = fitWithinBudget(orgEntries, ORG_BUDGET_BYTES);
  const fittedChannel = fitWithinBudget(channelEntries, CHANNEL_BUDGET_BYTES);
  const fittedAgent = fitWithinBudget(agentEntries, AGENT_BUDGET_BYTES);

  const applied: ProcedureApplied[] = [
    ...fittedOrg,
    ...fittedChannel,
    ...fittedAgent,
  ].map((p) => ({
    scope: p.scope,
    scopeId: p.scopeId,
    name: p.name,
    version: p.version,
    enforced: p.enforced,
  }));

  const sections: string[] = [];
  const lawEntries = fittedOrg.filter((p) => p.enforced);

  // Anthropic prompt-engineering recommendation: prepend a guidance
  // line so the model doesn't freeze on contradictory layers.
  if (fittedOrg.length > 0 || fittedChannel.length > 0 || fittedAgent.length > 0) {
    sections.push(
      'These are guidelines. When two conflict, pick the more specific scope and continue. Items marked LAW are non-negotiable.',
    );
  }

  if (fittedOrg.length > 0) {
    sections.push(
      'Workspace Culture — applies to everyone in this org. Call `procedure.view(name, scope:"org")` for the full body.',
      ...fittedOrg.map((p) => `- ${p.name}: ${p.description}`),
    );
  }
  if (fittedChannel.length > 0) {
    sections.push(
      'Channel Culture — applies in this channel. Call `procedure.view(name, scope:"channel")` for the full body.',
      ...fittedChannel.map((p) => `- ${p.name}: ${p.description}`),
    );
  }
  if (fittedAgent.length > 0) {
    sections.push(
      'Your own procedures — what you have learned. Call `self.procedure.view(name)` for the full body.',
      ...fittedAgent.map((p) => `- ${p.name}: ${p.description}`),
    );
  }

  let lawText: string | undefined;
  if (lawEntries.length > 0) {
    // For LAW entries we render the FULL body, not just the
    // description — the spec is explicit: "LAW (do not violate):
    // <body>". Capped at 3 entries so the prefix cost stays bounded.
    const lawLines = lawEntries
      .slice(0, LAW_HARD_CAP)
      .map((p) => `LAW (do not violate): ${p.body}`);
    lawText = lawLines.join('\n\n');
  }

  return {
    lawText,
    cultureText: sections.length > 0 ? sections.join('\n') : undefined,
    applied,
  };
}

/** Re-export for unit tests of write-time normalisation. */
export const PROCEDURE_LAW_HARD_CAP = LAW_HARD_CAP;
