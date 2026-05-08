interface ShellScopeSource {
  input: Record<string, unknown>;
  resourcePath?: string;
}

export interface NormalizedShellScope {
  cwd: string;
  command: string;
  args?: string[];
}

export function buildShellApprovalScope(source: ShellScopeSource): string {
  return `shell:${JSON.stringify(normalizeShellScope(source))}`;
}

export function normalizeShellScope(source: ShellScopeSource): NormalizedShellScope {
  const input = source.input ?? {};
  const cwd = typeof input.cwd === 'string' ? input.cwd : source.resourcePath ?? '';
  const commandText = typeof input.command === 'string' ? input.command : '';
  const explicitArgs = Array.isArray(input.args)
    ? input.args.map((arg) => String(arg))
    : undefined;

  if (explicitArgs) {
    return explicitArgs.length
      ? { cwd, command: commandText, args: explicitArgs }
      : { cwd, command: commandText };
  }

  const parsed = parseCommandText(commandText);
  if (!parsed) {
    return { cwd, command: commandText };
  }
  const parsedCwd = parsed.cwd ?? cwd;
  return parsed.args.length
    ? { cwd: parsedCwd, command: parsed.command, args: parsed.args }
    : { cwd: parsedCwd, command: parsed.command };
}

export function parseCommandText(commandText: string): { cwd?: string; command: string; args: string[] } | null {
  const tokens = tokenizeCommand(commandText);
  if (!tokens.length) return null;
  if (tokens[0] === 'cd' && tokens[1] && tokens[2] === '&&' && tokens[3]) {
    return { cwd: tokens[1], command: tokens[3], args: tokens.slice(4) };
  }
  const [command, ...args] = tokens;
  if (!command) return null;
  return { command, args };
}

function tokenizeCommand(commandText: string): string[] {
  const tokens = commandText.match(/'[^']*'|"([^"\\]|\\.)*"|\S+/g) ?? [];
  return tokens.map(unquoteToken);
}

function unquoteToken(token: string): string {
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1);
  }
  if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
    return token
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  return token;
}
