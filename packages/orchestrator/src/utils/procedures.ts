import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ProcedureScope = 'org' | 'channel' | 'agent';

export interface ProcedureFile {
  scope: ProcedureScope;
  scopeId: string;
  name: string;
  description: string;
  body: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
  enforced: boolean;
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
  lawText?: string;
  cultureText?: string;
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

export function proceduresDirFor(workspaceRoot: string, scope: ProcedureScope, scopeId: string): string {
  switch (scope) {
    case 'org':
      return join(workspaceRoot, 'ai', 'memory-bank', 'org', 'procedures');
    case 'channel':
      return join(workspaceRoot, 'ai', 'memory-bank', 'channels', safeSegment(scopeId), 'procedures');
    case 'agent':
      return join(workspaceRoot, 'ai', 'memory-bank', 'agents', safeSegment(scopeId), 'procedures');
  }
}

function procedureFilePath(workspaceRoot: string, scope: ProcedureScope, scopeId: string, name: string): string {
  return join(proceduresDirFor(workspaceRoot, scope, scopeId), `${name}.md`);
}

function memoryBankParts(filePath: string): string[] | null {
  const parts = filePath.split(/[\\/]+/).filter(Boolean);
  const aiIdx = parts.indexOf('ai');
  if (aiIdx < 0 || parts[aiIdx + 1] !== 'memory-bank') return null;
  return parts.slice(aiIdx + 2);
}

export function isProceduresPath(filePath: string): boolean {
  const parts = memoryBankParts(filePath);
  if (!parts) return false;
  const scopeRoot = parts[0];
  if (scopeRoot !== 'org' && scopeRoot !== 'channels' && scopeRoot !== 'agents') return false;
  return parts.includes('procedures');
}

export function isAgentRestrictedProcedurePath(memberId: string, filePath: string): boolean {
  const parts = memoryBankParts(filePath);
  if (!parts) return false;
  const scopeRoot = parts[0];
  if (scopeRoot === 'org' || scopeRoot === 'channels') return true;
  if (scopeRoot === 'agents') {
    const ownerSegment = parts[1];
    if (!ownerSegment) return false;
    return ownerSegment !== safeSegment(memberId);
  }
  return false;
}

function parseFrontmatter(raw: string): {
  meta: Record<string, string>;
  body: string;
} {
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

function procedureFromRaw(
  raw: string,
  input: {
    scope: ProcedureScope;
    scopeId: string;
    name: string;
    path: string;
    actorFallback: string;
    timeFallback: string;
  },
): ProcedureFile {
  const parsed = parseFrontmatter(raw);
  const createdAt = parsed.meta['created_at'] ?? input.timeFallback;
  const createdBy = parsed.meta['created_by'] ?? input.actorFallback;
  return {
    scope: input.scope,
    scopeId: input.scopeId,
    name: parsed.meta['name'] ?? input.name,
    description: parsed.meta['description'] ?? '',
    body: parsed.body,
    createdAt,
    createdBy,
    updatedAt: parsed.meta['updated_at'] ?? createdAt,
    updatedBy: parsed.meta['updated_by'] ?? createdBy,
    version: Number.parseInt(parsed.meta['version'] ?? '1', 10) || 1,
    enforced: input.scope === 'org' && parsed.meta['enforced']?.toLowerCase() === 'true',
    path: input.path,
  };
}

export function renderProcedureFile(file: ProcedureFile): string {
  const normalizedBody = file.body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
  const lines = ['---', `name: ${file.name}`, `description: ${file.description.replace(/\n+/g, ' ')}`, `created_at: ${file.createdAt}`, `created_by: ${file.createdBy}`, `updated_at: ${file.updatedAt}`, `updated_by: ${file.updatedBy}`, `version: ${file.version}`];
  if (file.scope === 'org' && file.enforced) {
    lines.push('enforced: true');
  }
  lines.push('---', '', normalizedBody, '');
  return lines.join('\n');
}

export async function listProceduresByScope(workspaceRoot: string, scope: ProcedureScope, scopeId: string): Promise<ProcedureFile[]> {
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
      out.push(
        procedureFromRaw(raw, {
          scope,
          scopeId,
          name: file.replace(/\.md$/, ''),
          path,
          actorFallback: 'unknown',
          timeFallback: '1970-01-01T00:00:00Z',
        }),
      );
    } catch {
      continue;
    }
  }
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

  let existing: ProcedureFile | null = null;
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, 'utf8');
      existing = procedureFromRaw(raw, {
        scope: input.scope,
        scopeId: input.scopeId,
        name: input.name,
        path,
        actorFallback: input.actor,
        timeFallback: now,
      });
    } catch {
      existing = null;
    }
  }

  if (input.scope === 'org' && input.enforced) {
    const all = await listProceduresByScope(input.workspaceRoot, 'org', '');
    const otherLaws = all.filter((p) => p.enforced && p.name !== input.name);
    if (otherLaws.length >= LAW_HARD_CAP) {
      throw new Error(`cannot mark "${input.name}" as enforced — org already has ${otherLaws.length} LAW entries (max ${LAW_HARD_CAP}).`);
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

export async function removeProcedure(workspaceRoot: string, scope: ProcedureScope, scopeId: string, name: string): Promise<boolean> {
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

function appendProcedureSection(sections: string[], title: string, entries: ProcedureFile[]): void {
  if (entries.length > 0) {
    sections.push(title, ...entries.map((p) => `- ${p.name}: ${p.description}`));
  }
}

export async function aggregateProcedures(input: { workspaceRoot: string; organizationId: string; memberId: string; channelId?: string }): Promise<AggregatorOutput> {
  const orgEntries = await listProceduresByScope(input.workspaceRoot, 'org', '');
  const channelEntries = input.channelId ? await listProceduresByScope(input.workspaceRoot, 'channel', input.channelId) : [];
  const agentEntries = await listProceduresByScope(input.workspaceRoot, 'agent', input.memberId);

  const fittedOrg = fitWithinBudget(orgEntries, ORG_BUDGET_BYTES);
  const fittedChannel = fitWithinBudget(channelEntries, CHANNEL_BUDGET_BYTES);
  const fittedAgent = fitWithinBudget(agentEntries, AGENT_BUDGET_BYTES);

  const applied: ProcedureApplied[] = [...fittedOrg, ...fittedChannel, ...fittedAgent].map((p) => ({
    scope: p.scope,
    scopeId: p.scopeId,
    name: p.name,
    version: p.version,
    enforced: p.enforced,
  }));

  const sections: string[] = [];
  const lawEntries = fittedOrg.filter((p) => p.enforced);

  if (fittedOrg.length > 0 || fittedChannel.length > 0 || fittedAgent.length > 0) {
    sections.push('These are guidelines. When two conflict, pick the more specific scope and continue. Items marked LAW are non-negotiable.');
  }

  appendProcedureSection(sections, 'Workspace Culture — applies to everyone in this org. Call `procedure.view(name, scope:"org")` for the full body.', fittedOrg);
  appendProcedureSection(sections, 'Channel Culture — applies in this channel. Call `procedure.view(name, scope:"channel")` for the full body.', fittedChannel);
  appendProcedureSection(sections, 'Your own procedures — what you have learned. Call `procedure view(name, scope:"self")` for the full body.', fittedAgent);

  let lawText: string | undefined;
  if (lawEntries.length > 0) {
    const lawLines = lawEntries.slice(0, LAW_HARD_CAP).map((p) => `LAW (do not violate): ${p.body}`);
    lawText = lawLines.join('\n\n');
  }

  return {
    lawText,
    cultureText: sections.length > 0 ? sections.join('\n') : undefined,
    applied,
  };
}

export const PROCEDURE_LAW_HARD_CAP = LAW_HARD_CAP;
