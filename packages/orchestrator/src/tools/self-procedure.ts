import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { OrchestratorTool } from './types.js';

/**
 * Bet 7 — procedural memory.
 *
 * Per-agent playbook file at `ai/memory-bank/agents/<member-id>/procedures.md`,
 * edited only by the agent that owns it (via these two tools), loaded
 * into the cache-stable Zone 2 of the system prompt. The file is the
 * authoritative store; the in-context surface is just a read of the
 * file. The agent's own write busts the cache but only on the (rare)
 * occasion it edits its playbook — every other wake is cache-hit.
 *
 * Procedures take the shape "When X, do Y." They are append-only by
 * convention but removable by index. Capped at PROCEDURE_FILE_MAX_BYTES
 * total (default 4 KB) so the cache-stable prefix doesn't grow without
 * bound. New entries that would exceed the cap evict the oldest.
 */

export const PROCEDURE_FILE_MAX_BYTES = 4 * 1024;
const PROCEDURES_HEADER = '# Procedures\n\n_Per-agent playbook. Updated via `self.procedure.add` / `self.procedure.remove`._\n';

const SelfProcedureAddSchema = z.object({
  when: z.string().min(2).max(240),
  then: z.string().min(2).max(480),
});

const SelfProcedureRemoveSchema = z.object({
  index: z.number().int().min(1).max(200),
});

export function proceduresPath(workspaceRoot: string, memberId: string): string {
  // Sanitise member-id for filesystem safety (UUIDs / "Layla Lane"
  // both possible). Strip anything not [A-Za-z0-9_-] and trim.
  const safe = memberId.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return join(workspaceRoot, 'ai', 'memory-bank', 'agents', safe || 'unknown-agent', 'procedures.md');
}

interface ProcedureEntry {
  when: string;
  then: string;
}

function parseProcedures(text: string): ProcedureEntry[] {
  const entries: ProcedureEntry[] = [];
  const pattern = /^- \*\*When\*\* (.+?) — \*\*then\*\* (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const whenClause = match[1];
    const thenClause = match[2];
    if (typeof whenClause === 'string' && typeof thenClause === 'string') {
      entries.push({
        when: whenClause.trim(),
        then: thenClause.trim(),
      });
    }
  }
  return entries;
}

function renderProcedures(entries: ProcedureEntry[]): string {
  if (entries.length === 0) return PROCEDURES_HEADER;
  const lines = entries.map(
    (entry) => `- **When** ${entry.when.replace(/\n+/g, ' ')} — **then** ${entry.then.replace(/\n+/g, ' ')}`,
  );
  return `${PROCEDURES_HEADER}\n${lines.join('\n')}\n`;
}

export async function loadProceduresFile(
  workspaceRoot: string,
  memberId: string,
): Promise<{ path: string; entries: ProcedureEntry[]; raw: string } | null> {
  const path = proceduresPath(workspaceRoot, memberId);
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return { path, raw, entries: parseProcedures(raw) };
}

async function saveProceduresFile(
  workspaceRoot: string,
  memberId: string,
  entries: ProcedureEntry[],
): Promise<{ path: string; bytes: number; entries: ProcedureEntry[]; raw: string }> {
  const path = proceduresPath(workspaceRoot, memberId);
  await mkdir(dirname(path), { recursive: true });
  let working = entries.slice();
  let rendered = renderProcedures(working);
  // Evict oldest entries until under the byte cap. Worst case: a
  // single huge entry; the schema-side max enforces individual
  // length so the eviction loop terminates.
  while (Buffer.byteLength(rendered, 'utf8') > PROCEDURE_FILE_MAX_BYTES && working.length > 1) {
    working = working.slice(1);
    rendered = renderProcedures(working);
  }
  await writeFile(path, rendered, 'utf8');
  return { path, bytes: Buffer.byteLength(rendered, 'utf8'), entries: working, raw: rendered };
}

export const selfProcedureAddTool: OrchestratorTool<typeof SelfProcedureAddSchema> = {
  id: 'self.procedure.add',
  schema: SelfProcedureAddSchema,
  toInvocation: (args) => ({
    action: 'message',
    resourceType: 'message',
    bypassPermission: true,
    input: args,
  }),
  execute: async ({ invocation, team }) => {
    const input = invocation.input as z.infer<typeof SelfProcedureAddSchema>;
    const existing = await loadProceduresFile(team.workspace.root, invocation.memberId);
    const baseEntries = existing?.entries ?? [];
    // Dedup: an exact same (when, then) pair shouldn't be added
    // twice. This isn't fuzzy — paraphrases will pass through, by
    // design (the agent can later remove the duplicate it judges
    // worse).
    const dup = baseEntries.find((e) => e.when === input.when.trim() && e.then === input.then.trim());
    if (dup) {
      return { ok: true, added: false, reason: 'duplicate', count: baseEntries.length };
    }
    const nextEntries = [...baseEntries, { when: input.when.trim(), then: input.then.trim() }];
    const saved = await saveProceduresFile(team.workspace.root, invocation.memberId, nextEntries);
    return {
      ok: true,
      added: true,
      count: saved.entries.length,
      bytes: saved.bytes,
      path: saved.path,
    };
  },
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
  execute: async ({ invocation, team }) => {
    const input = invocation.input as z.infer<typeof SelfProcedureRemoveSchema>;
    const existing = await loadProceduresFile(team.workspace.root, invocation.memberId);
    if (!existing || existing.entries.length === 0) {
      return { ok: false, reason: 'no procedures to remove' };
    }
    const oneBasedIndex = input.index;
    if (oneBasedIndex < 1 || oneBasedIndex > existing.entries.length) {
      return { ok: false, reason: `index ${oneBasedIndex} out of range (1..${existing.entries.length})` };
    }
    const next = existing.entries.filter((_, i) => i !== oneBasedIndex - 1);
    const saved = await saveProceduresFile(team.workspace.root, invocation.memberId, next);
    return {
      ok: true,
      removed: oneBasedIndex,
      count: saved.entries.length,
    };
  },
};
