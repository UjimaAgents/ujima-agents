export interface ParsedShellScope {
  cwd: string;
  command: string;
  args?: string[];
}

export interface ParsedFilesystemScope {
  action: 'read' | 'write';
  resourcePath: string;
  /** Present for write when encoded in JSON approval scope (permission gate). */
  patch?: string;
  /** Legacy write payloads; prefer `patch`. */
  content?: string;
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
        patch?: unknown;
        content?: unknown;
      };
      const action = parsed.action;
      const resourcePath = parsed.resourcePath;
      if (action !== 'read' && action !== 'write') return null;
      if (typeof resourcePath !== 'string' || !resourcePath.trim()) return null;
      const out: ParsedFilesystemScope = { action, resourcePath };
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

function relayFilesystemBlock(fs: ParsedFilesystemScope): string {
  const lines = ['```', fs.resourcePath, fs.action];
  const writeBody =
    fs.action === 'write'
      ? (fs.patch !== undefined && fs.patch.length > 0
          ? fs.patch
          : fs.content !== undefined && fs.content.length > 0
            ? fs.content
            : undefined)
      : undefined;
  if (writeBody !== undefined) {
    const body =
      writeBody.length > RELAY_FS_WRITE_BODY_MAX
        ? `${writeBody.slice(0, RELAY_FS_WRITE_BODY_MAX)}\n…`
        : writeBody;
    lines.push(body);
  }
  lines.push('```');
  return lines.join('\n');
}

/**
 * Compact chat body when an approval is relayed (e.g. owner DM).
 * Shell: fenced block with cwd then `$ command …`.
 * Filesystem: fenced block with path, action, and optional write body.
 * Otherwise: `action` · `path`.
 */
export function formatApprovalRelayMarkdown(approval: {
  action: string;
  resourcePath: string;
  reason: string;
}): string {
  const { shell, filesystem } = parseApprovalDisplayScopesFromReason(approval.reason);
  if (shell) {
    const cmd = shellInvocationDisplayLine(shell);
    return ['```', shell.cwd, `$ ${cmd}`, '```'].join('\n');
  }
  if (filesystem) {
    return relayFilesystemBlock(filesystem);
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
