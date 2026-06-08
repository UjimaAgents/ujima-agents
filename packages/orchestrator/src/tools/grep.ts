import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { assertWorkspaceBoundary } from '@ujima/shared/workspace';
import { isSensitiveWorkspacePath } from '@ujima/shared/workspace-file-filters';
import type { OrchestratorTool } from './types.js';
import { readWindowValue } from './window-utils.js';
import { resolveBinaryPath, RG_BINARY } from './binary-resolver.js';
import { runCli } from './cli-runner.js';

const DEFAULT_LIMIT = 50;
const DEFAULT_CONTEXT_LINES = 2;

export const GrepSchema = z.object({
  query: z.string().min(1),
  path: z.string().min(1).default('.'),
  limit: z.number().int().min(1).max(500).default(DEFAULT_LIMIT),
  contextLines: z.number().int().min(0).max(10).default(DEFAULT_CONTEXT_LINES),
  context_lines: z.number().int().min(0).max(10).optional(),
  ignoreCase: z.boolean().default(false),
});

export interface GrepContextLine {
  lineNumber: number;
  line: string;
}

export interface GrepMatch {
  path: string;
  lineNumber: number;
  line: string;
  before: GrepContextLine[];
  after: GrepContextLine[];
}

interface RgJsonLine {
  type: 'begin' | 'end' | 'match' | 'context' | 'summary';
  data: {
    path?: { text: string };
    lines?: { text: string };
    line_number?: number;
    submatches?: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

function stripTrailingNewline(s: string): string {
  return s.replace(/\n$/, '').replace(/\r$/, '');
}

export const grepTool: OrchestratorTool<typeof GrepSchema> = {
  id: 'grep',
  schema: GrepSchema,
  toInvocation: (args) => ({
    action: 'read',
    resourceType: 'folder',
    resourcePath: args.path,
    input: args,
  }),
  execute: async ({ invocation, team }) => {
    const query = String(invocation.input.query).trim();
    const resourcePath = invocation.resourcePath ?? String(invocation.input.path ?? '.');
    const ignoreCase = invocation.input.ignoreCase === true;
    const limit = readWindowValue(invocation.input.limit, DEFAULT_LIMIT);
    const contextLines = readWindowValue(
      invocation.input.context_lines ?? invocation.input.contextLines,
      DEFAULT_CONTEXT_LINES,
    );
    const resolved = assertWorkspaceBoundary(team.workspace.root, resourcePath);

    const bin = resolveBinaryPath(RG_BINARY, 'RG_BIN_PATH');
    const args = [
      '--json',
      '-n',
      ...(contextLines > 0 ? ['-C', String(contextLines)] : []),
      ...(ignoreCase ? ['-i'] : []),
      '--max-count', String(limit),
      '--', query, resolved,
    ];

    const { stdout, exitCode, stderr } = await runCli({
      bin,
      args,
      cwd: team.workspace.root,
      timeout: 15_000,
      maxStdoutBytes: 10 * 1024 * 1024,
      filterSensitivePaths: false,
    });

    if (exitCode !== null && exitCode > 1) {
      throw new Error(`ripgrep (exit ${exitCode}): ${stderr.slice(0, 500)}`);
    }

    // Parse rg --json stream into a flat list of events
    interface RgEvent {
      type: 'begin' | 'end' | 'match' | 'context' | 'summary';
      path: string;
      lineNumber?: number;
      text: string;
    }

    const events: RgEvent[] = [];
    let currentFilePath: string | null = null;

    for (const raw of stdout.split('\n').filter(Boolean)) {
      let obj: RgJsonLine;
      try { obj = JSON.parse(raw); } catch { continue; }

      const eventPath = obj.data.path?.text ?? currentFilePath ?? '';
      if (obj.type === 'begin' || obj.type === 'end') {
        currentFilePath = obj.data.path?.text ?? currentFilePath;
      }

      events.push({
        type: obj.type,
        path: eventPath,
        lineNumber: obj.data.line_number,
        text: stripTrailingNewline(obj.data.lines?.text ?? ''),
      });
    }

    // Build matches from events. For each match event, gather context
    // within the radius, split into before/after, and clip against
    // adjacent matches so context doesn't overlap.
    const contextRadius = contextLines;
    const matches: GrepMatch[] = [];

    for (let i = 0; i < events.length && matches.length < limit; i++) {
      const ev = events[i];
      const matchEv = ev as RgEvent;
      if (matchEv.type !== 'match') continue;

      const relPath = matchEv.path;
      if (!relPath) continue;
      const fullPath = joinPaths(team.workspace.root, relPath);
      if (isSensitiveWorkspacePath(fullPath)) continue;

      const matchLine = matchEv.lineNumber ?? 0;

      // Find adjacent matches for clipping
      const prevMatch = findPrevMatch(events, i, relPath);
      const nextMatch = findNextMatch(events, i, relPath);

      // Before-context: walk backwards within radius, stop at prev match
      const before: GrepContextLine[] = [];
      const beforeMinLine = prevMatch !== -1
        ? Math.max((events[prevMatch] as RgEvent).lineNumber! + 1, matchLine - contextRadius)
        : matchLine - contextRadius;

      for (let j = i - 1; j >= 0; j--) {
        const ctxEv = events[j] as RgEvent;
        if (ctxEv.type !== 'context') continue;
        if (ctxEv.path !== relPath) continue;
        const ln = ctxEv.lineNumber ?? 0;
        if (ln < beforeMinLine || ln >= matchLine) continue;
        before.unshift({ lineNumber: ln, line: ctxEv.text });
      }

      // After-context: walk forward within radius, stop at next match
      const after: GrepContextLine[] = [];
      const afterMaxLine = nextMatch !== -1
        ? Math.min((events[nextMatch] as RgEvent).lineNumber! - 1, matchLine + contextRadius)
        : matchLine + contextRadius;

      for (let j = i + 1; j < events.length; j++) {
        const ctxEv = events[j] as RgEvent;
        if (ctxEv.type !== 'context') continue;
        if (ctxEv.path !== relPath) continue;
        const ln = ctxEv.lineNumber ?? 0;
        if (ln > afterMaxLine || ln <= matchLine) continue;
        after.push({ lineNumber: ln, line: ctxEv.text });
      }

      matches.push({
        path: fullPath,
        lineNumber: matchLine,
        line: matchEv.text,
        before,
        after,
      });
    }

    function findPrevMatch(events: RgEvent[], currentIndex: number, path: string): number {
      for (let j = currentIndex - 1; j >= 0; j--) {
        const ev = events[j] as RgEvent | undefined;
        if (ev?.type === 'match' && ev.path === path) return j;
      }
      return -1;
    }

    function findNextMatch(events: RgEvent[], currentIndex: number, path: string): number {
      for (let j = currentIndex + 1; j < events.length; j++) {
        const ev = events[j] as RgEvent | undefined;
        if (ev?.type === 'match' && ev.path === path) return j;
      }
      return -1;
    }

    return {
      query,
      path: resolved,
      limit,
      contextLines,
      ignoreCase,
      truncated: matches.length >= limit,
      count: matches.length,
      matches,
    };
  },
};

function joinPaths(root: string, rel: string): string {
  return isAbsolute(rel) ? rel : join(root, rel);
}
