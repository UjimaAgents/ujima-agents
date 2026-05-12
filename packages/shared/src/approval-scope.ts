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
  return { shell: null, filesystem: parseFilesystemScope(scopeEncoded) };
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
