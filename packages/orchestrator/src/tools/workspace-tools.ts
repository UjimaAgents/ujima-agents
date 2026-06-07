import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { WorkspaceFileSchema } from '@ujima/shared';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import type { ApiRepository } from '../services/repository-reader.js';
import type { OrchestratorTool, ToolExecutionContext } from './types.js';
import { readWindowValue } from './window-utils.js';
import {
  isAgentRestrictedProcedurePath,
  isProceduresPath,
} from '../utils/procedures.js';

/**
 * Bet 4 — workspace-files FTS index. Every successful `write` /
 * `edit` / `multiedit` UPSERTs the post-edit body into the
 * `workspace_files` table; the FTS5 triggers from migration 026
 * keep the search index in lockstep. Best-effort — index failures
 * never block the on-disk write because the filesystem is the
 * system of record, the index is just an accelerator for
 * `channel.recall(scope: 'files')`.
 *
 * Channel attribution: pulled from `invocation.threadId` via the
 * threads table when present. A wake-run on a non-channel thread
 * (DM, self-channel) leaves channelId undefined — that's fine, the
 * recall path is org-scoped not channel-scoped today.
 */
function indexWorkspaceWrite(
  ctx: ToolExecutionContext,
  workspacePath: string,
  body: string,
): void {
  const repo: ApiRepository | undefined = ctx.repo;
  if (!repo?.upsertWorkspaceFile) return;
  try {
    if (isSensitiveWorkspacePath(workspacePath)) {
      repo.deleteWorkspaceFile?.(ctx.invocation.organizationId, workspacePath);
      return;
    }
    if (isProceduresPath(workspacePath)) {
      repo.deleteWorkspaceFile?.(ctx.invocation.organizationId, workspacePath);
      return;
    }
    const channelId = ctx.invocation.threadId
      ? repo.getThread(ctx.invocation.organizationId, ctx.invocation.threadId)?.channelId
      : undefined;
    repo.upsertWorkspaceFile(
      WorkspaceFileSchema.parse({
        organizationId: ctx.invocation.organizationId,
        path: workspacePath,
        body,
        writtenBy: ctx.invocation.memberId,
        channelId,
        sizeBytes: body.length,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Best-effort — never break a real write because the index
    // path errored. Larger-than-cap bodies are truncated inside
    // upsertWorkspaceFile; schema parse failures here log nothing
    // (the disk write already succeeded, we're indexing post-facto).
  }
}

// Hard cap for any single view (used as the schema's `limit.max`).
// Read windows MUST stay bounded so cached prefixes don't balloon —
// `messages` replays every prior tool result on every step, so a
// careless full-file read multiplies its cost across the run.
const VIEW_MAX_LIMIT = 1000;
// Default window when neither `lines` nor `limit` is provided.
// Tuned to a single screenful of code (≈ one focus area). Agents
// that need more should ask explicitly via `lines: "1-400"` or
// page through with `offset`/`limit`.
const VIEW_DEFAULT_LIMIT = 200;
const VIEW_MAX_BYTES = 200 * 1024;
const TREE_LIMIT = 1000;
const GLOB_LIMIT = 100;
const IGNORED_DIRECTORIES = new Set(['.git', '.next', 'build', 'coverage', 'dist', 'node_modules']);

// Only `file_path` is exposed in the model-facing JSON schema.
// Models don't see `resourcePath` because exposing the alias let
// Gemini pattern-match it onto unrelated tools (channel.post,
// channel.dm) and trip `additionalProperties: false`. There is no
// alias-back-compat: Zod's `.object()` strips unknown keys before
// our helpers run, so any caller passing `resourcePath` instead of
// `file_path` would already have failed validation regardless of
// what filePathFrom claimed.
const FilePathFields = {
  file_path: z.string().min(1).optional().describe('Workspace file path.'),
};

function filePathFrom(args: { file_path?: string }): string {
  return args.file_path ?? '';
}

function stringFrom(args: Record<string, unknown>, primary: string, alias: string): string {
  const value = args[alias] ?? args[primary];
  return typeof value === 'string' ? value : '';
}

function booleanFrom(args: Record<string, unknown>, primary: string, alias: string): boolean {
  const value = args[alias] ?? args[primary];
  return typeof value === 'boolean' ? value : false;
}

function numberFrom(args: Record<string, unknown>, primary: string, alias: string): number | undefined {
  const value = args[alias] ?? args[primary];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function matchStrategyFrom(args: Record<string, unknown>): 'exact' | 'whitespace' {
  return args.matchStrategy === 'whitespace' || args.match_strategy === 'whitespace' ? 'whitespace' : 'exact';
}

const EditSchema = z.object({
  ...FilePathFields,
  oldString: z.string().optional().describe('Exact text to replace. `old_string` is also accepted.'),
  old_string: z.string().optional().describe('Exact text to replace. Prefer this field.'),
  newString: z.string().optional().describe('Replacement text. `new_string` is also accepted.'),
  new_string: z.string().optional().describe('Replacement text. Prefer this field.'),
  replaceAll: z.boolean().optional().describe('Replace every occurrence. `replace_all` is also accepted.'),
  replace_all: z.boolean().optional().describe('Replace every occurrence. Prefer this field.'),
  startLine: z.number().int().min(1).optional().describe('1-based line near the intended match. `start_line` is also accepted.'),
  start_line: z.number().int().min(1).optional().describe('1-based line near the intended match. Prefer this field.'),
  matchStrategy: z.enum(['exact', 'whitespace']).optional().describe('Use whitespace only when formatting drift prevents an exact match.'),
  match_strategy: z.enum(['exact', 'whitespace']).optional().describe('Use whitespace only when formatting drift prevents an exact match. Prefer this field.'),
}).superRefine((value, ctx) => {
  if (!filePathFrom(value).trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_path'], message: 'file_path is required' });
  }
  if (stringFrom(value, 'oldString', 'old_string') === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['old_string'], message: 'old_string is required' });
  }
  if (stringFrom(value, 'newString', 'new_string') === '') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['new_string'], message: 'new_string is required' });
  }
});

const MultiEditSchema = z.object({
  ...FilePathFields,
  edits: z
    .array(
      z.object({
        oldString: z.string().optional().describe('Exact text to replace. `old_string` is also accepted.'),
        old_string: z.string().optional().describe('Exact text to replace. Prefer this field.'),
        newString: z.string().optional().describe('Replacement text. `new_string` is also accepted.'),
        new_string: z.string().optional().describe('Replacement text. Prefer this field.'),
        replaceAll: z.boolean().optional().describe('Replace every occurrence. `replace_all` is also accepted.'),
        replace_all: z.boolean().optional().describe('Replace every occurrence. Prefer this field.'),
        startLine: z.number().int().min(1).optional().describe('1-based line near the intended match. `start_line` is also accepted.'),
        start_line: z.number().int().min(1).optional().describe('1-based line near the intended match. Prefer this field.'),
        matchStrategy: z.enum(['exact', 'whitespace']).optional().describe('Use whitespace only when formatting drift prevents an exact match.'),
        match_strategy: z.enum(['exact', 'whitespace']).optional().describe('Use whitespace only when formatting drift prevents an exact match. Prefer this field.'),
      }).superRefine((value, ctx) => {
        if (stringFrom(value, 'oldString', 'old_string') === '') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['old_string'], message: 'old_string is required' });
        }
        if (stringFrom(value, 'newString', 'new_string') === '') {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['new_string'], message: 'new_string is required' });
        }
      }),
    )
    .min(1),
}).superRefine((value, ctx) => {
  if (!filePathFrom(value).trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_path'], message: 'file_path is required' });
  }
});

const ViewSchema = z.object({
  ...FilePathFields,
  lines: z
    .string()
    .optional()
    .describe(
      'Line range to read, 1-based and inclusive. Examples: "1-100", "120-200", "300-" (from 300 to default cap), "42" (just line 42). When set, overrides offset/limit.',
    ),
  offset: z.number().int().min(1).default(1),
  limit: z
    .number()
    .int()
    .min(1)
    .max(VIEW_MAX_LIMIT)
    .default(VIEW_DEFAULT_LIMIT)
    .describe(
      `Max lines to return. Defaults to ${VIEW_DEFAULT_LIMIT}. Cap is ${VIEW_MAX_LIMIT}. Prefer the smallest window that answers your question.`,
    ),
}).superRefine((value, ctx) => {
  if (!filePathFrom(value).trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_path'], message: 'file_path is required' });
  }
  if (value.lines !== undefined && parseLinesRange(value.lines) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lines'],
      message: 'lines must be a 1-based range like "1-100", "120-", or "42"',
    });
  }
});

const WriteSchema = z.object({
  ...FilePathFields,
  content: z.string().max(VIEW_MAX_BYTES).describe('Complete file contents to write. For small changes, prefer edit or multiedit.'),
}).superRefine((value, ctx) => {
  if (!filePathFrom(value).trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file_path'], message: 'file_path is required' });
  }
});

// Same rationale as FilePathFields above: the model-facing schema uses
// `path` (the convention `grep` already follows), never `resourcePath`,
// so Gemini doesn't pattern-match `resourcePath` onto unrelated tools
// (channel.post / channel.dm) and trip additionalProperties:false. The
// runtime reads from either alias for back-compat with older
// serialized calls.
const LsSchema = z.object({
  path: z.string().min(1).default('.'),
  ignore: z.array(z.string().min(1)).default([]),
  depth: z.number().int().min(0).max(20).default(0),
  limit: z.number().int().min(1).max(TREE_LIMIT).default(TREE_LIMIT),
});

const GlobSchema = z.object({
  path: z.string().min(1).default('.'),
  pattern: z.string().min(1),
  limit: z.number().int().min(1).max(TREE_LIMIT).default(GLOB_LIMIT),
});

function lsGlobPathFrom(args: { path?: string }): string {
  return args.path ?? '.';
}

export const viewTool: OrchestratorTool<typeof ViewSchema> = {
  id: 'view',
  schema: ViewSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'file',
    resourcePath: filePathFrom(args),
    input: {
      lines: args.lines,
      offset: args.offset,
      limit: args.limit,
    },
  }),
  execute: async ({ invocation, team }) => {
    if (!invocation.resourcePath) {
      throw new Error('file_path is required (the workspace file path)');
    }

    const resolved = resolveWorkspacePath(team.workspace.root, invocation.resourcePath);
    const resource = await stat(resolved);
    if (resource.isDirectory()) {
      throw new Error('view only supports files, not directories');
    }
    if (resource.size > VIEW_MAX_BYTES) {
      throw new Error(`File is too large (${resource.size} bytes). Maximum size is ${VIEW_MAX_BYTES} bytes`);
    }

    const linesRaw = invocation.input?.lines;
    const linesRange = typeof linesRaw === 'string' ? parseLinesRange(linesRaw) : null;
    const offset = linesRange
      ? linesRange.offset
      : readWindowValue(invocation.input?.offset, 1);
    const limit = Math.min(
      linesRange
        ? linesRange.limit
        : readWindowValue(invocation.input?.limit, VIEW_DEFAULT_LIMIT),
      VIEW_MAX_LIMIT,
    );
    const content = await readFile(resolved, 'utf8');

    return {
      type: 'file' as const,
      path: resolved,
      offset,
      limit,
      content: numberedWindow(content, offset, limit),
    };
  },
};

export const writeTool: OrchestratorTool<typeof WriteSchema> = {
  id: 'write',
  schema: WriteSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'file',
    resourcePath: filePathFrom(args),
    input: {
      content: args.content,
    },
  }),
  execute: async (ctx) => {
    const { invocation, team } = ctx;
    if (!invocation.resourcePath) {
      throw new Error('file_path is required (the workspace file path)');
    }
    assertAgentWritePermitted(invocation.memberId, invocation.resourcePath);

    const resolved = resolveWorkspacePath(team.workspace.root, invocation.resourcePath);
    const before = await readExistingText(resolved);
    const after = String(invocation.input?.content ?? '');
    if (before === after) {
      return {
        success: true,
        changed: false,
        path: resolved,
      };
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, after, 'utf8');
    indexWorkspaceWrite(ctx, invocation.resourcePath, after);
    return {
      success: true,
      changed: true,
      path: resolved,
      diff: createPatch(invocation.resourcePath, before, after),
    };
  },
};

export const editTool: OrchestratorTool<typeof EditSchema> = {
  id: 'edit',
  schema: EditSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'file',
    resourcePath: filePathFrom(args),
    input: {
      oldString: stringFrom(args, 'oldString', 'old_string'),
      newString: stringFrom(args, 'newString', 'new_string'),
      replaceAll: booleanFrom(args, 'replaceAll', 'replace_all'),
      startLine: numberFrom(args, 'startLine', 'start_line'),
      matchStrategy: matchStrategyFrom(args),
    },
  }),
  execute: async (ctx) => {
    const { invocation, team } = ctx;
    if (!invocation.resourcePath) {
      throw new Error('file_path is required (the workspace file path)');
    }
    assertAgentWritePermitted(invocation.memberId, invocation.resourcePath);

    const resolved = resolveWorkspacePath(team.workspace.root, invocation.resourcePath);
    const before = await readExistingText(resolved);
    const oldString = String(invocation.input?.oldString ?? '');
    const newString = String(invocation.input?.newString ?? '');
    const replaceAll = invocation.input?.replaceAll === true;
    const startLine = typeof invocation.input?.startLine === 'number' ? invocation.input.startLine : undefined;
    const matchStrategy = invocation.input?.matchStrategy === 'whitespace' ? 'whitespace' : 'exact';
    const after = applyEdit(before, oldString, newString, { replaceAll, startLine, matchStrategy });

    if (after === before) {
      return {
        success: true,
        changed: false,
        path: resolved,
      };
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, after, 'utf8');
    indexWorkspaceWrite(ctx, invocation.resourcePath, after);
    return {
      success: true,
      changed: true,
      path: resolved,
      diff: createPatch(invocation.resourcePath, before, after),
    };
  },
};

export const multieditTool: OrchestratorTool<typeof MultiEditSchema> = {
  id: 'multiedit',
  schema: MultiEditSchema,
  toInvocation: (args) => ({
    action: 'write',
    resourceType: 'file',
    resourcePath: filePathFrom(args),
    input: {
      edits: args.edits.map((edit) => ({
        oldString: stringFrom(edit, 'oldString', 'old_string'),
        newString: stringFrom(edit, 'newString', 'new_string'),
        replaceAll: booleanFrom(edit, 'replaceAll', 'replace_all'),
        startLine: numberFrom(edit, 'startLine', 'start_line'),
        matchStrategy: matchStrategyFrom(edit),
      })),
    },
  }),
  execute: async (ctx) => {
    const { invocation, team } = ctx;
    if (!invocation.resourcePath) {
      throw new Error('file_path is required (the workspace file path)');
    }
    assertAgentWritePermitted(invocation.memberId, invocation.resourcePath);

    const resolved = resolveWorkspacePath(team.workspace.root, invocation.resourcePath);
    const before = await readExistingText(resolved);
    let after = before;
    const edits = Array.isArray(invocation.input?.edits) ? invocation.input.edits : [];

    for (const edit of edits) {
      const oldString = String((edit as { oldString?: unknown }).oldString ?? '');
      const newString = String((edit as { newString?: unknown }).newString ?? '');
      const replaceAll = (edit as { replaceAll?: unknown }).replaceAll === true;
      const startLine = typeof (edit as { startLine?: unknown }).startLine === 'number'
        ? (edit as { startLine: number }).startLine
        : undefined;
      const matchStrategy = (edit as { matchStrategy?: unknown }).matchStrategy === 'whitespace'
        ? 'whitespace'
        : 'exact';
      after = applyEdit(after, oldString, newString, { replaceAll, startLine, matchStrategy });
    }

    if (after === before) {
      return {
        success: true,
        changed: false,
        path: resolved,
      };
    }

    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, after, 'utf8');
    indexWorkspaceWrite(ctx, invocation.resourcePath, after);
    return {
      success: true,
      changed: true,
      path: resolved,
      diff: createPatch(invocation.resourcePath, before, after),
    };
  },
};

export const lsTool: OrchestratorTool<typeof LsSchema> = {
  id: 'ls',
  schema: LsSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: lsGlobPathFrom(args),
    input: {
      ignore: args.ignore,
      depth: args.depth,
      limit: args.limit,
    },
  }),
  execute: async ({ invocation, team }) => {
    const resourcePath = typeof invocation.resourcePath === 'string' ? invocation.resourcePath : '.';
    const resolved = resolveWorkspacePath(team.workspace.root, resourcePath);
    const resource = await stat(resolved);
    const limit = readWindowValue(invocation.input?.limit, TREE_LIMIT);
    const depth = readWindowValue(invocation.input?.depth, 0);
    const ignore = Array.isArray(invocation.input?.ignore)
      ? invocation.input.ignore.map((entry) => String(entry))
      : [];
    const entries: TreeEntry[] = [];

    if (resource.isDirectory()) {
      await collectTreeEntries({
        root: resolved,
        current: resolved,
        currentDepth: 0,
        maxDepth: depth,
        ignore,
        entries,
        limit,
      });
    } else {
      entries.push({
        path: resolved,
        name: basename(resolved),
        isDir: false,
        depth: 0,
      });
    }

    const content = formatTreeOutput(resourcePath, entries, limit);
    return {
      path: resolved,
      content,
      count: entries.length,
      truncated: entries.length >= limit,
    };
  },
};

export const globTool: OrchestratorTool<typeof GlobSchema> = {
  id: 'glob',
  schema: GlobSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: lsGlobPathFrom(args),
    input: {
      pattern: args.pattern,
      limit: args.limit,
    },
  }),
  execute: async ({ invocation, team }) => {
    const searchRoot = resolveWorkspacePath(
      team.workspace.root,
      typeof invocation.resourcePath === 'string' ? invocation.resourcePath : '.',
    );
    const resource = await stat(searchRoot);
    const pattern = String(invocation.input?.pattern ?? '').trim();
    const limit = readWindowValue(invocation.input?.limit, GLOB_LIMIT);
    const matches: string[] = [];

    if (resource.isDirectory()) {
      await collectGlobMatches({
        root: searchRoot,
        current: searchRoot,
        pattern,
        limit,
        matches,
      });
    } else {
      const rel = relative(team.workspace.root, searchRoot) || basename(searchRoot);
      if (matchGlob(pattern, normalizePath(rel))) {
        matches.push(searchRoot);
      }
    }

    return {
      path: searchRoot,
      pattern,
      matches,
      count: matches.length,
      truncated: matches.length >= limit,
      content: matches.map((entry) => normalizePath(relative(team.workspace.root, entry) || entry)).join('\n'),
    };
  },
};

function resolveWorkspacePath(workspaceRoot: string, resourcePath: string): string {
  return assertWorkspaceBoundary(workspaceRoot, resourcePath);
}

function assertAgentWritePermitted(memberId: string, resourcePath: string): void {
  if (isAgentRestrictedProcedurePath(memberId, resourcePath)) {
    throw new Error(
      'agents may only write under ai/memory-bank/agents/<self>/. Use self.procedure.add for your own procedures; ask a human to change org/channel culture.',
    );
  }
}

async function readExistingText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return '';
    throw error;
  }
}

// Parses the `lines` shorthand on `view` ("1-100", "120-", "42").
// Returns null on any malformed input so the schema can surface a
// validation error instead of silently falling back to the default
// window — silent fallback would let an agent type "100-200ish" and
// re-read the whole file without noticing.
function parseLinesRange(input: string): { offset: number; limit: number } | null {
  const trimmed = input.trim();
  const match = /^(\d+)(?:-(\d*))?$/.exec(trimmed);
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isInteger(start) || start < 1) return null;
  const endRaw = match[2];
  if (endRaw === undefined) return { offset: start, limit: 1 };
  if (endRaw === '') return { offset: start, limit: VIEW_DEFAULT_LIMIT };
  const end = Number(endRaw);
  if (!Number.isInteger(end) || end < start) return null;
  return { offset: start, limit: end - start + 1 };
}

function numberedWindow(content: string, offset: number, limit: number): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(offset - 1, 0);
  const visible = lines.slice(start, start + limit);
  const endLine = start + visible.length;
  const width = String(Math.max(endLine, offset)).length;
  const numbered = visible.map((line, index) => `${String(offset + index).padStart(width, ' ')} | ${line}`);
  if (start + limit < lines.length) {
    numbered.push('');
    numbered.push(`(File has more lines. Use offset to read beyond line ${endLine})`);
  }
  return numbered.join('\n');
}

function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  options: { replaceAll: boolean; startLine?: number; matchStrategy: 'exact' | 'whitespace' },
): string {
  if (oldString.length === 0) {
    if (content.length === 0) {
      return newString;
    }
    throw new Error('oldString cannot be empty for an existing file');
  }

  if (options.matchStrategy === 'whitespace') {
    return applyWhitespaceEdit(content, oldString, newString, options);
  }

  const occurrences = countOccurrences(content, oldString);
  if (options.replaceAll) {
    if (occurrences === 0) {
      throw new Error('oldString was not found. Use view/grep to copy exact text, or set match_strategy="whitespace" for whitespace-only drift.');
    }
    return content.split(oldString).join(newString);
  }

  if (options.startLine && occurrences > 1) {
    const match = closestExactMatch(content, oldString, options.startLine);
    if (match) {
      return content.slice(0, match.index) + newString + content.slice(match.index + oldString.length);
    }
  }

  if (occurrences !== 1) {
    throw new Error(
      occurrences === 0
        ? 'oldString was not found. Use view/grep to copy exact text, or set match_strategy="whitespace" for whitespace-only drift.'
        : 'oldString matched multiple locations. Pass start_line near the intended match or replace_all=true.',
    );
  }
  return content.replace(oldString, newString);
}

function applyWhitespaceEdit(
  content: string,
  oldString: string,
  newString: string,
  options: { replaceAll: boolean; startLine?: number },
): string {
  if (oldString.trim().length === 0) {
    throw new Error('match_strategy="whitespace" requires at least one non-whitespace character in oldString');
  }
  const pattern = whitespacePattern(oldString);
  const flags = options.replaceAll ? 'g' : '';
  const regex = new RegExp(pattern, flags);
  const matches = [...content.matchAll(new RegExp(pattern, 'g'))];
  if (matches.length === 0) {
    throw new Error('oldString was not found, even with match_strategy="whitespace"');
  }
  if (options.replaceAll) {
    return content.replace(regex, () => newString);
  }
  const match = options.startLine
    ? closestRegexMatch(content, matches, options.startLine)
    : matches.length === 1 ? matches[0] : undefined;
  if (!match?.index && match?.index !== 0) {
    throw new Error('oldString matched multiple locations. Pass start_line near the intended match or replace_all=true.');
  }
  return content.slice(0, match.index) + newString + content.slice(match.index + match[0].length);
}

function whitespacePattern(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map(escapeRegex)
    .join('\\s+');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function closestExactMatch(content: string, oldString: string, startLine: number): { index: number } | undefined {
  const matches: { index: number; distance: number }[] = [];
  let index = content.indexOf(oldString);
  while (index !== -1) {
    matches.push({ index, distance: Math.abs(lineNumberAt(content, index) - startLine) });
    index = content.indexOf(oldString, index + oldString.length);
  }
  return matches.sort((a, b) => a.distance - b.distance)[0];
}

function closestRegexMatch(content: string, matches: RegExpMatchArray[], startLine: number): RegExpMatchArray | undefined {
  return matches
    .filter((match): match is RegExpMatchArray & { index: number } => typeof match.index === 'number')
    .sort((a, b) => Math.abs(lineNumberAt(content, a.index) - startLine) - Math.abs(lineNumberAt(content, b.index) - startLine))[0];
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = 0;
  while (index !== -1) {
    index = haystack.indexOf(needle, index);
    if (index === -1) break;
    count += 1;
    index += needle.length;
  }
  return count;
}

function createPatch(filePath: string, before: string, after: string): string {
  return createTwoFilesPatch(filePath, filePath, before, after, '', '', { context: 3 });
}

interface TreeEntry {
  path: string;
  name: string;
  isDir: boolean;
  depth: number;
}

async function collectTreeEntries(input: {
  root: string;
  current: string;
  currentDepth: number;
  maxDepth: number;
  ignore: string[];
  entries: TreeEntry[];
  limit: number;
}): Promise<void> {
  if (input.entries.length >= input.limit) return;

  const dirents = await readdir(input.current, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of dirents) {
    if (input.entries.length >= input.limit) return;
    if (dirent.name.startsWith('.')) continue;
    if (dirent.isDirectory() && IGNORED_DIRECTORIES.has(dirent.name)) continue;

    const fullPath = join(input.current, dirent.name);
    if (isSensitiveWorkspacePath(fullPath)) continue;

    const rel = normalizePath(relative(input.root, fullPath) || dirent.name);
    if (input.ignore.some((pattern) => matchGlob(pattern, rel) || matchGlob(pattern, basename(rel)))) {
      continue;
    }

    const isDir = dirent.isDirectory();
    input.entries.push({
      path: fullPath,
      name: dirent.name,
      isDir,
      depth: input.currentDepth,
    });

    if (isDir && (input.maxDepth === 0 || input.currentDepth + 1 < input.maxDepth)) {
      await collectTreeEntries({
        ...input,
        current: fullPath,
        currentDepth: input.currentDepth + 1,
      });
    }
  }
}

function formatTreeOutput(rootLabel: string, entries: TreeEntry[], limit: number): string {
  const lines = [normalizePath(rootLabel || '.')];
  for (const entry of entries) {
    const prefix = '  '.repeat(entry.depth);
    lines.push(`${prefix}${entry.name}${entry.isDir ? '/' : ''}`);
  }
  if (entries.length >= limit) {
    lines.push('');
    lines.push(`(Truncated after ${limit} entries)`);
  }
  return lines.join('\n');
}

async function collectGlobMatches(input: {
  root: string;
  current: string;
  pattern: string;
  limit: number;
  matches: string[];
}): Promise<void> {
  if (input.matches.length >= input.limit) return;

  const dirents = await readdir(input.current, { withFileTypes: true });
  dirents.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of dirents) {
    if (input.matches.length >= input.limit) return;
    if (dirent.name.startsWith('.')) continue;
    if (dirent.isDirectory() && IGNORED_DIRECTORIES.has(dirent.name)) continue;

    const fullPath = join(input.current, dirent.name);
    if (isSensitiveWorkspacePath(fullPath)) continue;

    if (dirent.isDirectory()) {
      await collectGlobMatches({
        ...input,
        current: fullPath,
      });
      continue;
    }

    const rel = normalizePath(relative(input.root, fullPath) || dirent.name);
    if (!matchGlob(input.pattern, rel) && !matchGlob(input.pattern, basename(rel))) continue;
    input.matches.push(fullPath);
  }
}

function matchGlob(pattern: string, candidate: string): boolean {
  const normalizedPattern = normalizePath(pattern.trim());
  const normalizedCandidate = normalizePath(candidate.trim());
  if (!normalizedPattern) return false;
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedCandidate);
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? '';
    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        const after = pattern[i + 2];
        if (after === '/') {
          source += '(?:.*/)?';
          i += 2;
          continue;
        }
        source += '.*';
        i += 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(char);
  }
  source += '$';
  return new RegExp(source);
}

function escapeRegExp(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function normalizePath(path: string): string {
  return path.split(sep).join('/');
}
