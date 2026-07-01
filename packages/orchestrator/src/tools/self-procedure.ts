import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

/**
 * Bet 7 + Bet 2 (post-Hermes review) — procedural memory.
 *
 * Per-agent playbook at
 * `ai/memory-bank/agents/<member-id>/procedures/<slug>.md`. Each
 * procedure is its OWN file with YAML-ish frontmatter:
 *
 *   ---
 *   name: ping-phoebe-on-long-threads
 *   description: When pinging Phoebe in a long thread, include the artifact path.
 *   created_at: 2026-05-24T14:00:00Z
 *   ---
 *   When: pinging Phoebe in a long thread
 *   Then: include the artifact path explicitly so she doesn't have to scroll.
 *
 * This replaces the original "one big procedures.md with 4 KB cap"
 * design. The Hermes pattern (`tools/skill_manager_tool.py`) treats
 * the description as the discovery surface: the system prompt
 * loads only `name + description` lines for every procedure; the
 * agent calls `procedure view(name, scope:"self")` to pull the full body
 * on demand. This is agentskills.io-compatible by construction.
 *
 * Backward compatibility: the legacy single-file `procedures.md`
 * is migrated lazily on first read — its `**When X — then Y**`
 * entries become individual files in the new directory.
 */

const PROCEDURE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const PROCEDURE_BODY_MAX_BYTES = 4 * 1024;
const PROCEDURE_LIST_HARD_CAP = 50;

const SelfProcedureAddSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(64)
    .regex(PROCEDURE_NAME_PATTERN, 'Use lowercase letters, digits, and hyphens only (2-64 chars).'),
  description: z.string().min(8).max(200),
  body: z.string().min(8).max(2000),
});

const SelfProcedureRemoveSchema = z.object({
  name: z.string().min(2).max(64),
});

const SelfProcedureViewSchema = z.object({
  name: z.string().min(2).max(64),
});

const SelfProcedureListSchema = z.object({});

export interface ProcedureFile {
  name: string;
  description: string;
  body: string;
  createdAt: string;
  path: string;
}

function safeMemberSegment(memberId: string): string {
  const safe = memberId.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return safe || 'unknown-agent';
}

export function proceduresDirPath(workspaceRoot: string, memberId: string): string {
  return join(
    workspaceRoot,
    'ai',
    'memory-bank',
    'agents',
    safeMemberSegment(memberId),
    'procedures',
  );
}

// Legacy single-file path; kept for backward compatibility on read.
function legacyProceduresFilePath(workspaceRoot: string, memberId: string): string {
  return join(
    workspaceRoot,
    'ai',
    'memory-bank',
    'agents',
    safeMemberSegment(memberId),
    'procedures.md',
  );
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const fenceMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fenceMatch) return { meta: {}, body: raw.trim() };
  const block = fenceMatch[1] ?? '';
  const body = (fenceMatch[2] ?? '').trim();
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (m && typeof m[1] === 'string' && typeof m[2] === 'string') {
      meta[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
  return { meta, body };
}

function renderProcedureFile(input: ProcedureFile): string {
  const lines = [
    '---',
    `name: ${input.name}`,
    `description: ${input.description.replace(/\n+/g, ' ')}`,
    `created_at: ${input.createdAt}`,
    '---',
    '',
    input.body.trim(),
    '',
  ];
  return lines.join('\n');
}

function procedureFilePath(workspaceRoot: string, memberId: string, name: string): string {
  const safeName = name.replaceAll(/[^a-z0-9-]/g, '-').replaceAll(/-+/g, '-').replace(/(^-|-$)/g, '');
  return join(proceduresDirPath(workspaceRoot, memberId), `${safeName || 'unnamed'}.md`);
}

/**
 * Lazy migration from the legacy single-file `procedures.md` to
 * the new directory layout. Runs at most once per agent on the
 * first read after the upgrade. Each `- **When X — then Y**` entry
 * becomes a separate file with an auto-generated slug.
 */
async function migrateLegacyIfNeeded(workspaceRoot: string, memberId: string): Promise<void> {
  const legacy = legacyProceduresFilePath(workspaceRoot, memberId);
  if (!existsSync(legacy)) return;
  const dir = proceduresDirPath(workspaceRoot, memberId);
  await mkdir(dir, { recursive: true });
  const raw = await readFile(legacy, 'utf8');
  const pattern = /^- \*\*When\*\* (.+?) — \*\*then\*\* (.+)$/gm;
  let match: RegExpExecArray | null;
  let counter = 1;
  const now = new Date().toISOString();
  while ((match = pattern.exec(raw)) !== null) {
    const whenClause = (match[1] ?? '').trim();
    const thenClause = (match[2] ?? '').trim();
    if (!whenClause || !thenClause) continue;
    const slug = `migrated-${String(counter).padStart(2, '0')}`;
    counter += 1;
    const file: ProcedureFile = {
      name: slug,
      description: whenClause.slice(0, 200),
      body: `When: ${whenClause}\nThen: ${thenClause}`,
      createdAt: now,
      path: procedureFilePath(workspaceRoot, memberId, slug),
    };
    await writeFile(file.path, renderProcedureFile(file), 'utf8');
  }
  // Rename the legacy file so the migration doesn't fire twice.
  await writeFile(`${legacy}.migrated`, raw, 'utf8');
  await unlink(legacy).catch(() => undefined);
}

export async function listProcedures(
  workspaceRoot: string,
  memberId: string,
): Promise<ProcedureFile[]> {
  await migrateLegacyIfNeeded(workspaceRoot, memberId);
  const dir = proceduresDirPath(workspaceRoot, memberId);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = (await readdir(dir))
      .filter((f) => f.endsWith('.md'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const out: ProcedureFile[] = [];
  for (const file of files) {
    const path = join(dir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const { meta, body } = parseFrontmatter(raw);
      const name = meta['name'] ?? file.replace(/\.md$/, '');
      const description = meta['description'] ?? '';
      const createdAt = meta['created_at'] ?? '1970-01-01T00:00:00Z';
      if (!name) continue;
      out.push({ name, description, body, createdAt, path });
    } catch {
      // skip unreadable
    }
  }
  out.sort((a, b) => {
    const byCreatedAt = b.createdAt.localeCompare(a.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    const byName = a.name.localeCompare(b.name);
    return byName !== 0 ? byName : a.path.localeCompare(b.path);
  });
  return out.slice(0, PROCEDURE_LIST_HARD_CAP);
}

/**
 * Used by the system-prompt loader. Returns a compact list of
 * `name: description` lines — NOT the full bodies — so the cache-
 * stable prefix doesn't balloon with every procedure the agent has
 * ever written. The agent calls `procedure view(name, scope:"self")` to
 * pull a body on demand.
 */
export async function loadProceduresForSystemPrompt(
  workspaceRoot: string,
  memberId: string,
): Promise<string | undefined> {
  const all = await listProcedures(workspaceRoot, memberId);
  if (all.length === 0) return undefined;
  const lines = all.map((p) => `- ${p.name}: ${p.description}`);
  return [
    '## Procedures available (call `procedure view(name, scope:"self")` to read a body):',
    ...lines,
  ].join('\n');
}

// Backwards-compatibility shim — system-prompt-builder.ts imports
// `loadProceduresFile` as a fallback. We keep the export but
// proxy to the new directory layout so existing callers see the
// same shape (.entries, .raw).
export async function loadProceduresFile(
  workspaceRoot: string,
  memberId: string,
): Promise<{ path: string; entries: { when: string; then: string }[]; raw: string } | null> {
  const all = await listProcedures(workspaceRoot, memberId);
  if (all.length === 0) return null;
  const entries = all.map((p) => {
    // Derive (when, then) from the body if it follows the
    // canonical shape; otherwise fall back to description.
    const wmatch = p.body.match(/^When:\s*(.+)$/im);
    const tmatch = p.body.match(/^Then:\s*(.+)$/im);
    return {
      when: (wmatch?.[1] ?? p.description).trim(),
      then: (tmatch?.[1] ?? p.body).trim(),
    };
  });
  const raw = all.map((p) => `- **When** ${entries[all.indexOf(p)]?.when} — **then** ${entries[all.indexOf(p)]?.then}`).join('\n');
  return { path: proceduresDirPath(workspaceRoot, memberId), entries, raw };
}

export const PROCEDURE_FILE_MAX_BYTES = PROCEDURE_BODY_MAX_BYTES;

// ── Shared execute helpers (used by both legacy and unified tools) ──

export async function executeAddProcedure(
  workspaceRoot: string,
  memberId: string,
  input: { name: string; description: string; body: string },
) {
  const dir = proceduresDirPath(workspaceRoot, memberId);
  await mkdir(dir, { recursive: true });
  const path = procedureFilePath(workspaceRoot, memberId, input.name);
  if (existsSync(path)) {
    return { ok: false, reason: `procedure "${input.name}" already exists; remove it first or pick a different name` };
  }
  const file: ProcedureFile = {
    name: input.name,
    description: input.description,
    body: input.body,
    createdAt: new Date().toISOString(),
    path,
  };
  await writeFile(path, renderProcedureFile(file), 'utf8');
  const all = await listProcedures(workspaceRoot, memberId);
  return { ok: true, added: true, name: file.name, count: all.length, path };
}

export async function executeRemoveProcedure(
  workspaceRoot: string,
  memberId: string,
  input: { name: string },
) {
  const path = procedureFilePath(workspaceRoot, memberId, input.name);
  if (!existsSync(path)) {
    return { ok: false, reason: `procedure "${input.name}" not found` };
  }
  await unlink(path);
  const all = await listProcedures(workspaceRoot, memberId);
  return { ok: true, removed: input.name, count: all.length };
}

export async function executeListProcedures(
  workspaceRoot: string,
  memberId: string,
) {
  const all = await listProcedures(workspaceRoot, memberId);
  return {
    procedures: all.map((p) => ({ name: p.name, description: p.description, createdAt: p.createdAt })),
  };
}

export async function executeViewProcedure(
  workspaceRoot: string,
  memberId: string,
  input: { name: string },
) {
  const all = await listProcedures(workspaceRoot, memberId);
  const hit = all.find((p) => p.name === input.name);
  if (!hit) {
    return { ok: false, reason: `procedure "${input.name}" not found`, available: all.map((p) => p.name) };
  }
  return { ok: true, name: hit.name, description: hit.description, body: hit.body, createdAt: hit.createdAt };
}

export async function executeUpdateProcedure(
  workspaceRoot: string,
  memberId: string,
  input: { name: string; description?: string; body?: string },
) {
  const path = procedureFilePath(workspaceRoot, memberId, input.name);
  if (!existsSync(path)) {
    return { ok: false, reason: `procedure "${input.name}" not found` };
  }
  const existingRaw = await readFile(path, 'utf8');
  const { meta } = parseFrontmatter(existingRaw);
  const existing = { description: meta['description'] ?? '', body: parseFrontmatter(existingRaw).body };
  const raw = renderProcedureFile({
    name: input.name,
    description: input.description ?? existing.description,
    body: input.body ?? existing.body,
    createdAt: meta['created_at'] ?? new Date().toISOString(),
    path,
  });
  await writeFile(path, raw, 'utf8');
  return { ok: true, updated: input.name };
}

// ── Legacy individual tool definitions ─────────────────────────────

export const selfProcedureAddTool: OrchestratorTool<typeof SelfProcedureAddSchema> = {
  id: 'self.procedure.add',
  schema: SelfProcedureAddSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team }) =>
    executeAddProcedure(team.workspace.root, invocation.memberId, invocation.input as z.infer<typeof SelfProcedureAddSchema>),
};

export const selfProcedureRemoveTool: OrchestratorTool<typeof SelfProcedureRemoveSchema> = {
  id: 'self.procedure.remove',
  schema: SelfProcedureRemoveSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team }) =>
    executeRemoveProcedure(team.workspace.root, invocation.memberId, invocation.input as z.infer<typeof SelfProcedureRemoveSchema>),
};

export const selfProcedureListTool: OrchestratorTool<typeof SelfProcedureListSchema> = {
  id: 'self.procedure.list',
  schema: SelfProcedureListSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team }) =>
    executeListProcedures(team.workspace.root, invocation.memberId),
};

export const selfProcedureViewTool: OrchestratorTool<typeof SelfProcedureViewSchema> = {
  id: 'self.procedure.view',
  schema: SelfProcedureViewSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team }) =>
    executeViewProcedure(team.workspace.root, invocation.memberId, invocation.input as z.infer<typeof SelfProcedureViewSchema>),
};
