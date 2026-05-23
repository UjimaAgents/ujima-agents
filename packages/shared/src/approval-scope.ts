export interface ParsedShellScope {
  cwd: string;
  command: string;
  args?: string[];
}

export interface ParsedFilesystemScope {
  action: 'read' | 'write';
  resourcePath: string;
  offset?: number;
  limit?: number;
  /** Present for write when encoded in JSON approval scope (permission gate). */
  patch?: string;
  /** Legacy write payloads; prefer `patch`. */
  content?: string;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}

export interface EditScopeInput {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
  matchStrategy?: 'exact' | 'whitespace';
  fileContent?: string | null;
}

export interface EditScopeFields {
  oldString: string;
  newString: string;
  replaceAll: boolean;
  startLine?: number;
  matchStrategy?: 'whitespace';
}

export function readEditRecord(edit: unknown): Omit<EditScopeInput, 'fileContent'> | null {
  if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return null;
  const item = edit as Record<string, unknown>;
  return {
    oldString: stringField(item, 'oldString', 'old_string') ?? '',
    newString: stringField(item, 'newString', 'new_string') ?? '',
    replaceAll: item.replaceAll === true || item.replace_all === true,
    matchStrategy: item.matchStrategy === 'whitespace' || item.match_strategy === 'whitespace' ? 'whitespace' : 'exact',
  };
}

export function enrichEditScopeFields(input: EditScopeInput): EditScopeFields {
  const replaceAll = input.replaceAll === true;
  let startLine: number | undefined;
  if (input.fileContent && input.oldString) {
    const idx = input.fileContent.indexOf(input.oldString);
    if (idx !== -1) {
      startLine = input.fileContent.slice(0, idx).split('\n').length;
    }
  }
  return {
    oldString: input.oldString,
    newString: input.newString,
    replaceAll,
    ...(input.matchStrategy === 'whitespace' ? { matchStrategy: 'whitespace' as const } : {}),
    ...(startLine !== undefined ? { startLine } : {}),
  };
}

/** Removes display-only fields so approval scope strings match across request and retry. */
export function stripApprovalScopeDisplayFields(scope: string): string {
  if (scope.startsWith('edit:')) {
    const payload = scope.slice('edit:'.length);
    if (!payload.startsWith('{')) return scope;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const { startLine: _start, ...rest } = parsed;
      return `edit:${JSON.stringify(rest)}`;
    } catch {
      return scope;
    }
  }
  if (scope.startsWith('multiedit:')) {
    const payload = scope.slice('multiedit:'.length);
    if (!payload.startsWith('{')) return scope;
    try {
      const parsed = JSON.parse(payload) as { resourcePath?: unknown; edits?: unknown };
      const edits = Array.isArray(parsed.edits)
        ? parsed.edits.map((edit) => {
            if (!edit || typeof edit !== 'object' || Array.isArray(edit)) return edit;
            const { startLine: _start, ...rest } = edit as Record<string, unknown>;
            return rest;
          })
        : parsed.edits;
      return `multiedit:${JSON.stringify({ ...parsed, edits })}`;
    } catch {
      return scope;
    }
  }
  return scope;
}

/** Adds startLine hints for approval UI when file content is available. */
export function enrichApprovalScopeForDisplay(
  scope: string,
  fileContent?: string | null,
): string {
  if (!fileContent) return scope;
  if (scope.startsWith('edit:')) {
    const payload = scope.slice('edit:'.length);
    if (!payload.startsWith('{')) return scope;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const fields = readEditRecord(parsed);
      if (!fields) return scope;
      const enriched = enrichEditScopeFields({ ...fields, fileContent });
      return `edit:${JSON.stringify({
        resourcePath: parsed.resourcePath,
        ...enriched,
      })}`;
    } catch {
      return scope;
    }
  }
  if (scope.startsWith('multiedit:')) {
    const payload = scope.slice('multiedit:'.length);
    if (!payload.startsWith('{')) return scope;
    try {
      const parsed = JSON.parse(payload) as {
        resourcePath?: unknown;
        edits?: unknown;
      };
      let currentContent = fileContent;
      const edits = Array.isArray(parsed.edits)
        ? parsed.edits.map((edit) => {
            const fields = readEditRecord(edit);
            if (!fields) return edit;
            const enriched = enrichEditScopeFields({ ...fields, fileContent: currentContent });
            if (currentContent && fields.oldString) {
              const idx = currentContent.indexOf(fields.oldString);
              if (idx !== -1) {
                currentContent = enriched.replaceAll
                  ? currentContent.split(fields.oldString).join(fields.newString)
                  : currentContent.slice(0, idx) +
                    fields.newString +
                    currentContent.slice(idx + fields.oldString.length);
              }
            }
            return enriched;
          })
        : parsed.edits;
      return `multiedit:${JSON.stringify({ ...parsed, edits })}`;
    } catch {
      return scope;
    }
  }
  return scope;
}

function splitDiffLines(prefix: '+' | '-', value: string): string[] {
  const lines = value.split(/\r?\n/);
  return lines.map((line) => `${prefix}${line}`);
}

function proposedWriteDiff(resourcePath: string, content: string): string {
  const lineCount = Math.max(1, content.split(/\r?\n/).length);
  return [
    `--- ${resourcePath}`,
    `+++ ${resourcePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...splitDiffLines('+', content),
  ].join('\n');
}

function proposedEditDiff(resourcePath: string, oldString: string, newString: string, startLine?: number): string {
  const oldLineCount = oldString.split(/\r?\n/).length;
  const newLineCount = newString.split(/\r?\n/).length;
  const hunkHeader = startLine !== undefined
    ? `@@ -${startLine},${oldLineCount} +${startLine},${newLineCount} @@`
    : '@@';
  return [
    `--- ${resourcePath}`,
    `+++ ${resourcePath}`,
    hunkHeader,
    ...splitDiffLines('-', oldString),
    ...splitDiffLines('+', newString),
  ].join('\n');
}

export interface ParsedGrepScope {
  query: string;
  resourcePath: string;
  limit?: number;
  ignoreCase?: boolean;
}

export function parseApprovalReasonValue(reason: string, key: string): string | null {
  const match = reason.match(new RegExp(`(?:^|[;:])${key}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function parseShellScope(scope: string): ParsedShellScope | null {
  if (!scope.startsWith('shell:')) return null;
  const payload = scope.slice('shell:'.length);

  if (payload.startsWith('{')) {
    try {
      const parsed = JSON.parse(payload) as {
        cwd?: unknown;
        command?: unknown;
        args?: unknown;
      };
      if (typeof parsed.cwd !== 'string' || typeof parsed.command !== 'string') {
        return null;
      }
      const args = Array.isArray(parsed.args) ? parsed.args.map((arg) => String(arg)) : undefined;
      return args?.length ? { cwd: parsed.cwd, command: parsed.command, args } : { cwd: parsed.cwd, command: parsed.command };
    } catch {
      return null;
    }
  }

  const [cwd, command, argsPart] = payload.split(':', 3);
  if (!cwd || !command) return null;
  const args = parseLegacyArgs(argsPart);
  return args?.length ? { cwd, command, args } : { cwd, command };
}

/** Single-line shell invocation for display (not argv-safe). */
export function shellInvocationDisplayLine(parsed: ParsedShellScope): string {
  return [parsed.command, ...(parsed.args ?? [])].join(' ').trim();
}

/**
 * Reads `scope=` from the approval reason and returns at most one of shell or filesystem.
 * Prefer this over repeating `parseApprovalReasonValue` + `parseShellScope` + `parseFilesystemScope`.
 */
export function parseApprovalDisplayScopesFromReason(reason: string): {
  shell: ParsedShellScope | null;
  filesystem: ParsedFilesystemScope | null;
} {
  const scopeEncoded = parseApprovalReasonValue(reason, 'scope');
  if (!scopeEncoded) return { shell: null, filesystem: null };
  const shell = parseShellScope(scopeEncoded);
  if (shell) return { shell, filesystem: null };
  return { shell: null, filesystem: parseFilesystemScope(scopeEncoded) ?? parseWorkspaceWriteScope(scopeEncoded) };
}

export function canonicalizeApprovalGrantScope(scope: string): string {
  return canonicalizeApprovalScope(scope, false);
}

export function canonicalizeApprovalFamilyScope(scope: string): string {
  return canonicalizeApprovalScope(scope, true);
}

/** True when stored and requested scopes match at grant precision (args included for shell). */
export function approvalScopeMatches(storedScope: string, requestedScope: string): boolean {
  return (
    canonicalizeApprovalGrantScope(storedScope) === canonicalizeApprovalGrantScope(requestedScope)
  );
}

/** Matches a pending approval scope against a persisted grant/family scope from resolution. */
export function approvalScopeMatchesPersisted(
  approvalScope: string,
  persistedScope: string,
  mode: 'grant' | 'family',
): boolean {
  if (mode === 'grant') {
    return canonicalizeApprovalGrantScope(approvalScope) === persistedScope;
  }
  return (
    canonicalizeApprovalGrantScope(approvalScope) === persistedScope ||
    canonicalizeApprovalFamilyScope(approvalScope) === persistedScope
  );
}

export const APPROVAL_GRANT_ALWAYS_PREFIX = 'grant:always_allow:';
export const APPROVAL_GRANT_FAMILY_PREFIX = 'grant:always_allow_family:';

export function formatPersistedApprovalGrantReason(
  mode: 'grant' | 'family',
  persistedScope: string,
  note: string,
): string {
  const prefix = mode === 'family' ? APPROVAL_GRANT_FAMILY_PREFIX : APPROVAL_GRANT_ALWAYS_PREFIX;
  return `${prefix}scope=${encodeURIComponent(persistedScope)};note=${note}`;
}

function persistedGrantMode(grantReason: string): 'grant' | 'family' {
  return grantReason.includes(APPROVAL_GRANT_FAMILY_PREFIX) ? 'family' : 'grant';
}

/** True when an approved always-allow row covers the requested tool scope. */
export function approvalPersistedGrantMatches(
  grantReason: string,
  storedScope: string,
  requestedScope: string,
): boolean {
  const mode = persistedGrantMode(grantReason);
  const persistedCanonical =
    mode === 'family'
      ? canonicalizeApprovalFamilyScope(storedScope)
      : canonicalizeApprovalGrantScope(storedScope);
  if (approvalScopeMatchesPersisted(requestedScope, persistedCanonical, mode)) {
    return true;
  }
  // Legacy allow_family rows used grant:always_allow: with a family-shaped canonical scope.
  if (
    mode === 'grant' &&
    canonicalizeApprovalFamilyScope(storedScope) === canonicalizeApprovalGrantScope(storedScope)
  ) {
    return approvalScopeMatchesPersisted(
      requestedScope,
      canonicalizeApprovalFamilyScope(storedScope),
      'family',
    );
  }
  return false;
}

/**
 * Filesystem tool approval scope from the permission gate (`filesystem:{json}`)
 * or orchestrator inner gate (`filesystem:read:/abs/path`).
 */
export function parseFilesystemScope(scope: string): ParsedFilesystemScope | null {
  if (!scope.startsWith('filesystem:')) return null;
  const payload = scope.slice('filesystem:'.length);

  if (payload.startsWith('{')) {
    try {
      const parsed = JSON.parse(payload) as {
        action?: unknown;
        resourcePath?: unknown;
        offset?: unknown;
        limit?: unknown;
        patch?: unknown;
        content?: unknown;
      };
      const action = parsed.action;
      const resourcePath = parsed.resourcePath;
      if (action !== 'read' && action !== 'write') return null;
      if (typeof resourcePath !== 'string' || !resourcePath.trim()) return null;
      const out: ParsedFilesystemScope = { action, resourcePath };
      if (typeof parsed.offset === 'number' && Number.isFinite(parsed.offset)) {
        out.offset = parsed.offset;
      }
      if (typeof parsed.limit === 'number' && Number.isFinite(parsed.limit)) {
        out.limit = parsed.limit;
      }
      if (typeof parsed.patch === 'string') out.patch = parsed.patch;
      if (typeof parsed.content === 'string') out.content = parsed.content;
      return out;
    } catch {
      return null;
    }
  }

  const colon = payload.indexOf(':');
  if (colon === -1) return null;
  const action = payload.slice(0, colon);
  const resourcePath = payload.slice(colon + 1);
  if (action !== 'read' && action !== 'write') return null;
  if (!resourcePath) return null;
  return { action, resourcePath };
}

function parseWorkspaceWriteScope(scope: string): ParsedFilesystemScope | null {
  const prefix = scope.startsWith('write:')
    ? 'write:'
    : scope.startsWith('edit:')
      ? 'edit:'
      : scope.startsWith('multiedit:')
        ? 'multiedit:'
        : null;
  if (!prefix) return null;
  const payload = scope.slice(prefix.length);
  if (!payload.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    const resourcePath = stringField(parsed, 'resourcePath', 'file_path');
    if (!resourcePath?.trim()) return null;

    if (prefix === 'write:') {
      const content = stringField(parsed, 'content');
      return {
        action: 'write',
        resourcePath,
        patch: content !== undefined ? proposedWriteDiff(resourcePath, content) : undefined,
      };
    }

    if (prefix === 'edit:') {
      const oldString = stringField(parsed, 'oldString', 'old_string');
      const newString = stringField(parsed, 'newString', 'new_string');
      const startLine = typeof parsed.startLine === 'number' ? parsed.startLine : undefined;
      return {
        action: 'write',
        resourcePath,
        patch:
          oldString !== undefined && newString !== undefined
            ? proposedEditDiff(resourcePath, oldString, newString, startLine)
            : undefined,
      };
    }

    const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
    const patch = edits
      .map((edit) => {
        const fields = readEditRecord(edit);
        if (!fields) return '';
        const startLine =
          edit && typeof edit === 'object' && !Array.isArray(edit)
            ? (edit as Record<string, unknown>).startLine
            : undefined;
        return fields.oldString !== undefined && fields.newString !== undefined
          ? proposedEditDiff(
              resourcePath,
              fields.oldString,
              fields.newString,
              typeof startLine === 'number' ? startLine : undefined,
            )
          : '';
      })
      .filter(Boolean)
      .join('\n');
    return { action: 'write', resourcePath, patch: patch || undefined };
  } catch {
    return null;
  }
}

/**
 * Normalizes approval scope strings for grant matching.
 * - Grant mode (family=false): full scope including shell args and download URLs.
 * - Family mode (family=true): shell drops args; download keeps its URL.
 * - Paths are posix-normalized; legacy write:/edit: shapes map to filesystem grants.
 */
function canonicalizeApprovalScope(scope: string, family: boolean): string {
  const shell = parseShellScope(scope);
  if (shell) {
    return `shell:${JSON.stringify({
      cwd: normalizeApprovalPath(shell.cwd),
      command: shell.command,
      ...(family || !shell.args?.length ? {} : { args: shell.args }),
    })}`;
  }

  const filesystem = parseFilesystemScope(scope) ?? parseWorkspaceWriteScope(scope);
  if (filesystem) {
    return `filesystem:${JSON.stringify({
      action: filesystem.action,
      resourcePath: normalizeApprovalPath(filesystem.resourcePath),
    })}`;
  }

  if (scope.startsWith('download:')) {
    const payload = scope.slice('download:'.length);
    if (payload.startsWith('{')) {
      try {
        const parsed = JSON.parse(payload) as {
          resourcePath?: unknown;
          url?: unknown;
        };
        const resourcePath =
          typeof parsed.resourcePath === 'string' && parsed.resourcePath.trim()
            ? normalizeApprovalPath(parsed.resourcePath)
            : undefined;
        const url = typeof parsed.url === 'string' ? parsed.url.trim() : '';
        if (resourcePath || url) {
          return `download:${JSON.stringify({
            ...(resourcePath ? { resourcePath } : {}),
            ...(url ? { url } : {}),
          })}`;
        }
      } catch {
        /* fall through */
      }
    }
  }

  if (scope.startsWith('job_kill:')) {
    return 'job_kill';
  }

  if (scope.startsWith('fetch:')) {
    const payload = scope.slice('fetch:'.length);
    if (payload.startsWith('{')) {
      try {
        const parsed = JSON.parse(payload) as { url?: unknown };
        if (typeof parsed.url === 'string' && parsed.url.trim()) {
          return `fetch:${JSON.stringify({ url: parsed.url.trim() })}`;
        }
      } catch {
        /* fall through */
      }
    }
  }

  const firstColon = scope.indexOf(':');
  const secondColon = firstColon === -1 ? -1 : scope.indexOf(':', firstColon + 1);
  if (firstColon > 0 && secondColon > firstColon) {
    const resourceType = scope.slice(0, firstColon);
    const action = scope.slice(firstColon + 1, secondColon);
    const resourcePath = scope.slice(secondColon + 1).trim();
    if (resourceType && action && resourcePath) {
      return `${resourceType}:${action}:${normalizeApprovalPath(resourcePath)}`;
    }
  }

  return scope;
}

/** Browser-safe posix-style path normalization (no node:path — shared ships to webview). */
function normalizeApprovalPath(value: string): string {
  const trimmed = value.replace(/\\/g, '/').trim() || '.';
  const absolute = trimmed.startsWith('/');
  const stack: string[] = [];
  for (const part of trimmed.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join('/');
  if (absolute) return `/${joined}`;
  return joined || '.';
}

const RELAY_FS_WRITE_BODY_MAX = 4000;

function relayShellPlain(shell: ParsedShellScope): string {
  const cmd = shellInvocationDisplayLine(shell);
  return [`[Approval needed] Shell`, `Cwd: ${shell.cwd}`, `Command: ${cmd}`].join('\n');
}

function relayFilesystemPlain(fs: ParsedFilesystemScope): string {
  const lines = [`[Approval needed] Filesystem ${fs.action}`, `Path: ${fs.resourcePath}`];
  if (fs.action === 'read' && (fs.offset !== undefined || fs.limit !== undefined)) {
    lines.push(
      `Window: offset=${fs.offset ?? 1}, limit=${fs.limit ?? 20}`,
    );
  }
  if (fs.action === 'write') {
    const writeBody =
      fs.patch !== undefined && fs.patch.length > 0
        ? fs.patch
        : fs.content !== undefined && fs.content.length > 0
          ? fs.content
          : undefined;
    if (writeBody !== undefined) {
      const body =
        writeBody.length > RELAY_FS_WRITE_BODY_MAX
          ? `${writeBody.slice(0, RELAY_FS_WRITE_BODY_MAX)}\n… (truncated)`
          : writeBody;
      lines.push('Patch:', body);
    }
  }
  return lines.join('\n');
}

/**
 * Plain-text body when an approval is relayed (e.g. owner DM).
 * Intentionally avoids fenced blocks that mirror in-app tool UI so history
 * does not train the model to paste fake tool transcripts.
 */
export function formatApprovalRelayMarkdown(approval: {
  action: string;
  resourcePath: string;
  reason: string;
}): string {
  const { shell, filesystem } = parseApprovalDisplayScopesFromReason(approval.reason);
  if (shell) {
    return relayShellPlain(shell);
  }
  if (filesystem) {
    return relayFilesystemPlain(filesystem);
  }
  return `\`${approval.action}\` · \`${approval.resourcePath}\``;
}

function parseLegacyArgs(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((arg) => String(arg));
    }
  } catch {
    return [value];
  }
  return [value];
}
